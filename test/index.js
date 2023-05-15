'use strict';
require('dotenv').config();
const assert = require('chai').assert;
const sinon = require('sinon');
const { QueueClient } = require('@azure/storage-queue');
const Consumer = require('../index');
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const queueName = process.env.AZURE_QUEUE_NAME;

describe('Consumer', () => {
  describe('#constructor()', () => {
    it('should create a new Consumer instance', () => {
      const options = {
        connectionString,
        queueName,
        handleMessage: sinon.stub()
      };
      const consumer = new Consumer(options);
      assert(consumer instanceof Consumer);
    });

    it('should throw an error if required options are missing', () => {
      const options = {};
      assert.throws(() => {
        new Consumer(options);
      }, /queueName is required/);
    });

    it('should set properties of the Consumer instance', () => {
      const options = {
        connectionString,
        queueName,
        handleMessage: sinon.stub(),
        batchSize: 5,
        pollDelaySeconds: 3,
        maximumExecutionTimeSeconds: 30
      };
      const consumer = new Consumer(options);
      assert.strictEqual(consumer.connectionString, connectionString);
      assert.strictEqual(consumer.queueName, queueName);
      assert.strictEqual(consumer.handleMessage, options.handleMessage);
      assert.strictEqual(consumer.batchSize, 5);
      assert.strictEqual(consumer.pollDelaySeconds, 3);
      assert.strictEqual(consumer.maximumExecutionTimeSeconds, 30);
    });

    it('should use default values for some options if not provided', () => {
      const options = {
        connectionString,
        queueName,
        handleMessage: sinon.stub()
      };
      const consumer = new Consumer(options);
      assert.strictEqual(consumer.batchSize, 1);
      assert.strictEqual(consumer.pollDelaySeconds, 1);
      assert.strictEqual(consumer.maximumExecutionTimeSeconds, 10);
    });
  });

  describe('#start()', () => {
    let consumer;
    let receiveMessagesStub;
    beforeEach(() => {
      const options = {
        connectionString,
        queueName,
        handleMessage: sinon.stub()
      };
      consumer = new Consumer(options);
      receiveMessagesStub = sinon.stub(QueueClient.prototype, 'receiveMessages');
    });
    afterEach(() => {
      receiveMessagesStub.restore();
    });

    it('should start polling the queue for messages', () => {
      consumer.start();
      sinon.assert.calledOnce(receiveMessagesStub);
    });

    it('should emit a "starting listening process" event', (done) => {
      consumer.on('starting listening process', () => {
        done();
      });
      consumer.start();
    });
  });

  describe('#stop()', () => {
    it('should stop the polling process', () => {
      const consumer = new Consumer({
        connectionString,
        queueName,
        handleMessage: sinon.stub()
      });
      consumer.stopped = false;
      consumer.stop();
      assert(consumer.stopped);
    });

    it('should emit a "stopped" event', (done) => {
      const consumer = new Consumer({
        connectionString,
        queueName,
        handleMessage: sinon.stub()
      });
      consumer.on('stopped', () => {
        done();
      });
      consumer.stop();
    });
  });

  describe('#should process a message', () => {
    it('should process a message', () => {
      const options = {
        connectionString,
        queueName,
        handleMessage: (message, done) => {
          assert.strictEqual(message.messageText, 'Test message');
          done();
        }
      };
      const consumer = new Consumer(options);
      // Add a test message to the queue
      const queueClient = new QueueClient(options.connectionString, options.queueName);
      queueClient.sendMessage('Test message');
      // Test queue should be empty upon test completion
      consumer.start();
      consumer.on('No messages availabe to be processed', () => {
        consumer.stop();
      });
    }).timeout(3000);

    it('should throw an error when processing messages', () => {
      const options = {
        connectionString,
        queueName,
        handleMessage: (message) => {
          throw new Error(`Test error: ${message.messageText}`);
        }
      };
      const consumer = new Consumer(options);
      // Add a test message to the queue
      const queueClient = new QueueClient(options.connectionString, options.queueName);
      queueClient.sendMessage('Test message');
      // Test queue should be empty upon test completion
      consumer.start();
      consumer.on('processing_error', () => {
        consumer.stop();
      });
    }).timeout(3000);
  });

  describe('#should throw error for invalid options', () => {
    it('should throw an error if handleMessage is not a function', () => {
      const options = {
        connectionString,
        queueName,
        handleMessage: 'not a function'
      };
      assert.throws(() => {
        new Consumer(options);
      }, /handleMessage must be a function/);
    });

    it('should throw an error if batchSize is not a number', () => {
      const options = {
        connectionString,
        queueName,
        handleMessage: sinon.stub(),
        batchSize: 'not a number'
      };
      assert.throws(() => {
        new Consumer(options);
      }, /batchSize must be between 1 and 10 and be a number./);
    });

    it('should throw an error if batchSize is less than 1', () => {
      const options = {
        connectionString,
        queueName,
        handleMessage: sinon.stub(),
        batchSize: 0
      };
      assert.throws(() => {
        new Consumer(options);
      }, /batchSize must be between 1 and 30./);
    });

    it('should throw an error if connectionString is not provided', () => {
      const options = {
        queueName,
        handleMessage: sinon.stub()
      };
      assert.throws(() => {
        new Consumer(options);
      }, /connectionString is required./);
    });

    it('should throw an error if queueName is not provided', () => {
      const options = {
        connectionString,
        handleMessage: sinon.stub()
      };
      assert.throws(() => {
        new Consumer(options);
      }, /queueName is required/);
    });

    it('should throw an error if handleMessage is not provided or not a function', () => {
      const options = {
        connectionString,
        queueName,
        handleMessage: 'not a function'
      };
      assert.throws(() => {
        new Consumer(options);
      }, /handleMessage must be a function/);
    });

    it('should throw an error if QueueClient is not an instance QueueClient', () => {
      const options = {
        connectionString,
        queueName,
        queueService: 'not a function',
        handleMessage: sinon.stub()
      };
      assert.throws(() => {
        new Consumer(options);
      }, /queueService must be an instance of QueueClient./);
    });
  });

  describe('_poll()', () => {
    let consumer;
    beforeEach(() => {
      consumer = new Consumer({
        connectionString,
        queueName,
        handleMessage: sinon.stub(),
        batchSize: 10,
        maximumExecutionTimeSeconds: 30,
        visibilityTimeout: 10,
        maximumRetries: 2
      });
    });
    it('receives messages with the correct parameters', async () => {
      const response = {
        receivedMessageItems: [
          {
            messageId: '899d6748-5f4a-4092-addf-52e4d3686ee3',
            insertedOn: '2023-05-14T23:21:29.000Z',
            expiresOn: '2023-05-21T23:21:29.000Z',
            popReceipt: 'AgAAAAMAAAAAAAAAHhLuxruG2QE=',
            nextVisibleOn: '2023-05-14T23:28:23.000Z',
            dequeueCount: 1,
            messageText: 'Test message'
          }
        ]
      };
      await consumer._poll();
      assert(consumer._handleQueueServiceResponse(null, response), 'should call _handleQueueServiceResponse');
    });

    it('check if an error is recieved', async () => {
      const err = new Error('test error');
      assert(consumer._handleQueueServiceResponse(err, null), 'should call _handleQueueServiceResponse');
    });

    it('deletes messages that have exceeded retry count', async () => {
      const response = {
        receivedMessageItems: [
          {
            messageId: '899d6748-5f4a-4092-addf-52e4d3686ee3',
            insertedOn: '2023-05-14T23:21:29.000Z',
            expiresOn: '2023-05-21T23:21:29.000Z',
            popReceipt: 'AgAAAAMAAAAAAAAAHhLuxruG2QE=',
            nextVisibleOn: '2023-05-14T23:28:23.000Z',
            dequeueCount: 3,
            messageText: 'Test message'
          }
        ]
      };
      assert(consumer._handleQueueServiceResponse(null, response), 'should call processMessage');
    });

    it('throw error if _processMessage hits an error', async () => {
      const response = {
        receivedMessageItems: [
          {
            messageId: '899d6748-5f4a-4092-addf-52e4d3686ee3',
            insertedOn: '2023-05-14T23:21:29.000Z',
            expiresOn: '2023-05-21T23:21:29.000Z',
            popReceipt: 'AgAAAAMAAAAAAAAAHhLuxruG2QE=',
            nextVisibleOn: '2023-05-14T23:28:23.000Z',
            dequeueCount: 3
          }
        ]
      };
      assert(consumer._handleQueueServiceResponse(null, response), 'should throw QueueServiceError');
    });

    it('should continue polling if message is empty', async () => {
      const response = {
        receivedMessageItems: []
      };
      assert(consumer._handleQueueServiceResponse(null, response), 'should restart polling');
      await new Promise((resolve)=>setTimeout(resolve, 502));
      assert(consumer.isWaiting, 'Polling flag should be set to true.');
      consumer.stop();
    });
  });
});
