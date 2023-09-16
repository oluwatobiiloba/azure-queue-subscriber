"use strict";

const EventEmitter = require("events").EventEmitter;
const { QueueClient } = require("@azure/storage-queue");
const debug = require("debug")("azure-queue-subscriber");
const requiredOptions = ["queueName", "handleMessage", "connectionString"];
const autoBind = require("auto-bind");
const { Logtail } = require("@logtail/node");

class QueueServiceError extends Error {
  constructor() {
    super(Array.from(arguments));
    this.name = this.constructor.name;
  }
}

/**
 * Validates options object.
 * @param {Object} options - An object containing configuration options.
 * @param {Array} requiredOptions - An array of strings containing the names of required options.
 * @throws {Error} Will throw an error if any required option is missing or batchSize is not between 1 and 10.
 */
function validate(options, requiredOptions) {
  for (const option of requiredOptions) {
    if (!options[option]) {
      throw new Error(`${option} is required.`);
    }
  }

  if (options.batchSize > 30 || options.batchSize < 1) {
    throw new Error("batchSize must be between 1 and 30.");
  }

  if (
    options.batchSize &&
    (typeof options.batchSize !== "number" || options.batchSize % 1 !== 0)
  ) {
    throw new Error("batchSize must be between 1 and 10 and be a number.");
  }

  if (options.visibilityTimeout && options.visibilityTimeout < 1) {
    throw new Error("visibilityTimeout must be greater than 0.");
  }

  if (options.handleMessage && typeof options.handleMessage !== "function") {
    throw new Error("handleMessage must be a function.");
  }

  if (options.queueService && !(options.queueService instanceof QueueClient)) {
    throw new Error("queueService must be an instance of QueueClient.");
  }

  if (
    options.useLogtailLogger &&
    !(options.logtailKey || options.loggerService instanceof Logtail)
  ) {
    throw new Error(
      "logtail key or instance is required to use the logger functionality"
    );
  }
}

/**
 * Checks if an error is due to authentication failure.
 * @param {Error} err - The error object to be checked.
 * @returns {boolean} Returns true if the error is due to authentication failure, false otherwise.
 */
function isAuthenticationError(err) {
  return err.statusCode === 403 || err.code === "CredentialsError";
}

/**
 * A class representing a message Consumer.
 * @extends EventEmitter
 */
class Consumer extends EventEmitter {
  constructor(options) {
    super();
    // Validate options passed into the class constructor
    validate(options, requiredOptions);
    // Set properties of the Consumer instance based on the passed in options object
    this.connectionString = options.connectionString;
    this.queueName = options.queueName;
    this.handleMessage = options.handleMessage;
    this.attributeNames = undefined;
    this.messageAttributeNames = undefined;
    this.stopped = true;
    this.isWaiting = false;
    this.batchSize = options.batchSize || 1;
    this.visibilityTimeout = options.visibilityTimeout || null;
    this.terminateVisibilityTimeout = undefined;
    this.pollDelaySeconds = options.pollDelaySeconds || 1;
    this.maximumExecutionTimeSeconds =
      options.maximumExecutionTimeSeconds || 10;
    this.authenticationErrorTimeoutSeconds =
      options.authenticationErrorTimeoutSeconds || 10;
    this.queueService =
      options.queueService ||
      new QueueClient(this.connectionString, this.queueName);
    this.maximumRetries = options.maximumRetries || null;
    this.useLogtailLogger = options.useLogtailLogger || false;
    this.logtailKey = options.logtailKey || null;
    try {
      this.loggerService = this.useLogtailLogger
        ? options.loggerService || new Logtail(this.logtailKey)
        : null;
    } catch (err) {
      throw new Error(`Error creating Logtail logger: ${err}`);
    }
    // Bind `this` to methods used by the class
    autoBind(this);
  }

  /**
   * Static method to create a new Consumer instance.
   * @param {Object} options - Options for configuring the Consumer class instance.
   * @returns {Consumer} An instance of the Consumer class.
   */
  static create(options) {
    return new Consumer(options);
  }

  /**
   * Method to start the Consumer instance.
   */
  start() {
    if (this.stopped) {
      debug("Starting consumer");
      this._log("Starting consumer", "info");
      this.stopped = false;
      this._poll();
    }
  }

  /**
   * Method to stop the running Consumer instance.
   */
  stop() {
    debug("Stopping consumer");
    this.emit("stopped");
    this.isWaiting = true;
    this.stopped = true;
  }

  /**
   * Private method to poll the queue for messages to consume.
   */
  async _poll() {
    const receiveParams = {
      numberOfMessages: this.batchSize,
      timeout: this.maximumExecutionTimeSeconds * 1000,
      visibilityTimeout: this.visibilityTimeout,
    };

    //set polling flag to true
    this.isWaiting = true;

    if (!this.stopped) {
      debug("Polling for messages");
      this.emit("starting");
      await this.queueService
        .receiveMessages(receiveParams)
        .then((response) => {
          this._handleQueueServiceResponse(null, response);
        })
        .catch((err) => {
          this._handleQueueServiceResponse(err, null);
        });
    } else {
      this.emit("stopped");
    }
  }

  /**
   * Private method to handle the response received from the queue service.
   * @param {Error} err - The error object returned from the queue service or null.
   * @param {Object} response - The response object returned from the queue service or null.
   */
  async _handleQueueServiceResponse(err, response) {
    const subscriber = this;
    if (err || !response) {
      subscriber.emit(
        "error",
        new QueueServiceError(
          "Queue service failed to recieve a message: " + err.message
        )
      );
    }
    debug("Received queue service response");
    debug(response);
    if (response?.receivedMessageItems?.length === 0)
      subscriber.emit("No messages availabe to be processed");
    if (response && response?.receivedMessageItems?.length > 0) {
      // If there are messages in the response, process them.
      for (const message of response.receivedMessageItems) {
        try {
          if (!this.maximumRetries) return this._processMessage(message);
          if (message.dequeueCount < this.maximumRetries) {
            await this._processMessage(message);
            subscriber.emit("message_processed", message);
            subscriber._poll();
            return;
          }
          await this._deleteMessage(message);
          const errorMessage = `message failed after ${message.dequeueCount} times and will be deleted`;

          this._log("message_processing_failed", {
            messageId: message.messageId,
            info: errorMessage,
          });
          // this.loggerService
          //   .info("message_processing_failed", {
          //     messageId: message.messageId,
          //     info: errorMessage,
          //   })
          //   .catch((logError) => {
          //     this.emit("Error logging with Logtail:", logError);
          //   });
          debug(errorMessage);
          subscriber.emit("delete_failed_message", errorMessage);
          subscriber._poll();
        } catch (err) {
          switch (err.name) {
            case QueueServiceError.name:
              subscriber.emit("error", err, message);
              subscriber._poll();
              break;
            default:
              subscriber.emit("processing_error", err, message);
              subscriber._poll();
              break;
          }
        }
      }
      // Emit a `response_processed` event once all messages in the response have been processed.
      subscriber.emit("response_processed");
      // Poll again for new messages once all messages in the queue response have been processed.
      subscriber._poll();
    } else if (err && isAuthenticationError(err)) {
      // If there was an authentication error, pause polling for a bit before retrying.
      debug(
        "There was an error with your credentials. Pausing before retrying."
      );
      setTimeout(
        () => subscriber._poll(),
        subscriber.authenticationErrorTimeoutSeconds * 1000
      );
    } else {
      // If there were no messages in the response, start polling again after a set delay.
      setTimeout(() => subscriber._poll(), subscriber.pollDelaySeconds * 500);
    }
  }

  /**
   * Private method to process an individual message from the queue.
   * @param {Object} message - The message object being processed.
   */
  async _processMessage(message) {
    const subscriber = this;
    this.emit("message_received", message);
    try {
      await new Promise((resolve, reject) => {
        subscriber.handleMessage(message, (err) => {
          if (err) {
            reject(
              new Error(`Unexpected message handler failure: ${err.message}`)
            );
          } else {
            resolve();
          }
        });
      });

      await subscriber._deleteMessage(message);

      this.emit("message_processed", message);
    } catch (err) {
      // If there is an error while processing a message, call `_handleError()` and throw the error.
      this._handleError(err, message);
      throw err;
    }
  }

  /**
   * Private method to handle errors that occur while processing messages.
   * @param {Error} err - The error object that was thrown.
   * @param {Object} message - The message object that caused the error.
   */
  _handleError(err, message) {
    if (this.loggerService) {
      this.loggerService
        .error(err, "message-processing", {
          message: message.messageText,
          messageId: message.messageId,
        })
        .catch((logError) => {
          this.emit("logtail_error", logError);
        });
      this.loggerService.flush();
    }
    if (err.name === QueueServiceError.name) {
      this.emit("error", err, message);
    } else {
      this.emit("processing_error", err, message);
    }
  }

  /**
   * Private method to delete a message from the queue after it has been processed.
   * @param {Object} message - The message object to be deleted.
   */
  async _deleteMessage(message) {
    debug(`Deleting message ${message.messageId}`);
    try {
      await this.queueService.deleteMessage(
        message.messageId,
        message.popReceipt
      );
    } catch (err) {
      if (this.loggerService) {
        this.loggerService
          .error(err, "message-deletion", {
            messageId: message.messageId,
            popReceipt: message.popReceipt,
          })
          .catch((logError) => {
            this.emit("logtail_error", logError);
          });
        this.loggerService.flush();
      }
      // If there is an error while deleting the message from the queue, throw a new QueueServiceError with the error message.
      throw new QueueServiceError(
        `Queue service delete message failed: ${err.message}`
      );
    }
  }

  /**
   * Private method to logging if logtail service is available
   * @param {info} info - The message object to be logged.
   */

  async _log(info, type) {
    try {
      if (this.loggerService) {
        this.loggerService[type](info);
      }
      this.loggerService.flush();
    } catch (err) {
      this.emit("logtail_error", err);
    }
  }
}

module.exports = Consumer;
