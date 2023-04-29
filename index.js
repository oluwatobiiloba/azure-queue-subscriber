'use strict';

const EventEmitter = require('events').EventEmitter;
const { QueueClient, QueueServiceClient } = require("@azure/storage-queue");
const debug = require('debug')('azure-queue-consumer');
const auto = require('auto-bind');
const requiredOptions = ['queueName', 'handleMessage', 'connectionString'];


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

  if (options.batchSize > 10 || options.batchSize < 1) {
    throw new Error('Batch size must be between 1 and 10.');
  }
}


/**
 * Checks if an error is due to authentication failure.
 * @param {Error} err - The error object to be checked.
 * @returns {boolean} Returns true if the error is due to authentication failure, false otherwise.
 */
function isAuthenticationError(err) {
  return (err.statusCode === 403 || err.code === 'CredentialsError');
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
    this.visibilityTimeout = undefined;
    this.terminateVisibilityTimeout = undefined;
    this.pollDelaySeconds = options.pollDelaySeconds || 1;
    this.maximumExecutionTimeSeconds = options.maximumExecutionTimeSeconds || 10;
    this.authenticationErrorTimeoutSeconds = options.authenticationErrorTimeoutSeconds || 10;
    this.queueService = options.queueService || new QueueClient(this.connectionString, this.queueName);

    // Bind `this` to methods used by the class
    auto(this);
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
      debug('Starting consumer');
      this.stopped = false;
      this._poll();
    }
  }

  /**
   * Method to stop the running Consumer instance.
   */
  stop() {
    debug('Stopping consumer');
    this.stopped = true;
  }

  /**
   * Private method to poll the queue for messages to consume.
   */
  async _poll() {
    const receiveParams = {
      numberOfMessages: this.batchSize,
      timeout: this.maximumExecutionTimeSeconds * 1000,
      visibilityTimeout: this.visibilityTimeout
    };

    if (!this.stopped) {
      debug('Polling for messages');
      this.emit('starting listening process');
      await this.queueService.receiveMessages(receiveParams)
        .then((response) => {
          this._handleQueueServiceResponse(null, response);
        })
        .catch((err) => {
          this._handleQueueServiceResponse(err, null);
        });
    } else {
      this.emit('stopped');
    }
  }

  /**
   * Private method to handle the response received from the queue service.
   * @param {Error} err - The error object returned from the queue service or null.
   * @param {Object} response - The response object returned from the queue service or null.
   */
  async _handleQueueServiceResponse(err, response) {
    const consumer = this;
  
    if (err || !response) {
      this.emit('error', new QueueServiceError('Queue service receive message failed: ' + err.message));
    }
  
    debug('Received queue service response');
    debug(response);

    if (response && response?.receivedMessageItems.length > 0) {
      // If there are messages in the response, process them.
      for (const message of response.receivedMessageItems) {
        try {
          await this._processMessage(message);
          consumer.emit('message_processed', message);
        } catch (err) {
          // If there is an error processing the message, emit either an `error` or `processing_error` event depending on the error name.
          if (err.name === QueueServiceError.name) {
            consumer.emit('error', err, message);
          } else {
            consumer.emit('processing_error', err, message);
          }
        }
      }

      // Emit a `response_processed` event once all messages in the response have been processed.
      consumer.emit('response_processed');

      // Poll again for new messages once all messages in the queue response have been processed.
      consumer._poll();
      
    } else if (err && isAuthenticationError(err)) {
      // If there was an authentication error, pause polling for a bit before retrying.
      debug('There was an error with your credentials. Pausing before retrying.');
      setTimeout(() => consumer._poll(), consumer.authenticationErrorTimeoutSeconds * 1000);
    } else {
      // If there were no messages in the response, start polling again after a set delay.
      setTimeout(() => consumer._poll(), consumer.pollDelaySeconds * 1000);
    }
  }
  
  /**
   * Private method to process an individual message from the queue.
   * @param {Object} message - The message object being processed.
   */
  async _processMessage(message) {
    const consumer  = this;
  
    this.emit('message_received', message);
  
    try {
      await new Promise((resolve, reject) => {
        consumer.handleMessage(message, (err) => {
          if (err) {
            reject(new Error(`Unexpected message handler failure: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
  
      await consumer._deleteMessage(message);

      this.emit('message_processed', message);
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
    // If the error name is `QueueServiceError`, emit an `error` event. Otherwise, emit a `processing_error` event.
    if (err.name === QueueServiceError.name) {
      this.emit('error', err, message);
    } else {
      this.emit('processing_error', err, message);
    }
  }
  
  /**
   * Private method to delete a message from the queue after it has been processed.
   * @param {Object} message - The message object to be deleted.
   */
  async _deleteMessage(message) {
    debug(`Deleting message ${message.messageId}`);
    try {
      await this.queueService.deleteMessage(message.messageId, message.popReceipt);
    } catch (err) {
      // If there is an error while deleting the message from the queue, throw a new QueueServiceError with the error message.
      throw new QueueServiceError(`Queue service delete message failed: ${err.message}`);
    }
  }
}

module.exports = Consumer;
