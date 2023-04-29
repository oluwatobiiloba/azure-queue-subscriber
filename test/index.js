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
  });
});
