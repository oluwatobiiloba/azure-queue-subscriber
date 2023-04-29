'use strict';
require('dotenv').config();
const Consumer = require('../index');
const { QueueClient } = require("@azure/storage-queue");
const debug = require('debug')('azure-queue-consumer');

const jest = require("jest")
const mockQueueService = new QueueClient(process.env.AZURE_STORAGE_CONNECTION_STRING, process.env.AZURE_QUEUE_NAME);

jest.mock('@azure/storage-queue', () => {
  return {
    QueueClient: jest.fn().mockImplementation(() => {
      return {
        receiveMessages: jest.fn(),
        deleteMessage: jest.fn()
      };
    }),
    QueueServiceClient: jest.fn().mockImplementation(() => {
      return {
        getQueueClient: jest.fn().mockReturnValue(mockQueueService)
      };
    })
  };
});

describe('Consumer class', () => {

  describe('constructor', () => {    
    it('should set properties based on options object', () => {
      const options = {
        queueName: 'test-queue',
        handleMessage: jest.fn(),
        connectionString: 'mockConnectionString',
        batchSize: 5,
        pollDelaySeconds: 5,
        maximumExecutionTimeSeconds: 20,
        authenticationErrorTimeoutSeconds: 15,
      };
      
      const consumer = Consumer.create(options);
      
      expect(consumer.queueService).toBe(mockQueueService);
      expect(consumer.queueName).toBe(options.queueName);
      expect(consumer.handleMessage).toBe(options.handleMessage);
      expect(consumer.batchSize).toBe(options.batchSize);
      expect(consumer.pollDelaySeconds).toBe(options.pollDelaySeconds);
      expect(consumer.maximumExecutionTimeSeconds).toBe(options.maximumExecutionTimeSeconds);
      expect(consumer.authenticationErrorTimeoutSeconds).toBe(options.authenticationErrorTimeoutSeconds);
      expect(consumer.connectionString).toBe(options.connectionString);
      expect(consumer.stopped).toBeTruthy();
      expect(consumer.isWaiting).toBeFalsy();
    });

    it('should throw an error if a required option is missing', () => {
      const options = {};
      
      expect(() => {
        Consumer.create(options);
      }).toThrowError(/is required/);
    });

    it('should throw an error if batchSize is not between 1 and 10', () => {
      const options = {
        queueName: 'test-queue',
        handleMessage: jest.fn(),
        connectionString: 'mockConnectionString',
        batchSize: 15
      };
      
      expect(() => {
        Consumer.create(options);
      }).toThrowError(/Batch size must be between 1 and 10/);
    });
  });

  describe('start method', () => {    
    it('should call _poll method when stopped is true', async () => {
      const options = {
        queueName: 'test-queue',
        handleMessage: jest.fn(),
        connectionString: 'mockConnectionString'
      };
      
      const consumer = Consumer.create(options);

      consumer._poll = jest.fn();
      
      consumer.start();

      expect(consumer.stopped).toBeFalsy();
      expect(consumer._poll).toHaveBeenCalled();
    });
  });

  describe('stop method', () => {    
    it('should set stopped to true', async () => {
      const options = {
        queueName: 'test-queue',
        handleMessage: jest.fn(),
        connectionString: 'mockConnectionString'
      };
      
      const consumer = Consumer.create(options);

      consumer.stop();

      expect(consumer.stopped).toBeTruthy();
    });
  });

  describe('_poll method', () => {    
    it('should emit error event if receiveMessages returns an error', async () => {
      const options = {
        queueName: 'test-queue',
        handleMessage: jest.fn(),
        connectionString: 'mockConnectionString'
      };
      
      const consumer = Consumer.create(options);

      consumer.emit = jest.fn();
      consumer.queueService.receiveMessages.mockRejectedValueOnce(new Error('test error'));

      await consumer._poll();

      expect(consumer.emit).toHaveBeenCalledWith('error', expect.any(QueueServiceError));
    });

    it('should handle empty response from receiveMessages method and call _poll again after a set delay', async () => {
      const options = {
        queueName: 'test-queue',
        handleMessage: jest.fn(),
        connectionString: 'mockConnectionString'
      };
      
      const consumer = Consumer.create(options);

      consumer.emit = jest.fn();
      consumer.queueService.receiveMessages.mockResolvedValueOnce({});

      await consumer._poll();

      expect(consumer.emit).toHaveBeenCalledWith('response_processed');
      expect(consumer._poll).toHaveBeenCalledTimes(1);
    });

    it('should handle non-empty response from receiveMessages method, process messages, and call _poll again after all messages are processed', async () => {
      const message1 = { messageId: 'message1' };
      const message2 = { messageId: 'message2' };
      const response = {
        receivedMessageItems: [message1, message2]
      };

      const options = {
        queueName: 'test-queue',
        handleMessage: jest.fn(),
        connectionString: 'mockConnectionString'
      };
      
      const consumer = Consumer.create(options);

      consumer.emit = jest.fn();
      consumer._processMessage = jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      consumer._deleteMessage = jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
      consumer.queueService.receiveMessages.mockResolvedValueOnce(response);

      await consumer._poll();

      expect(consumer.emit).toHaveBeenCalledWith('message_received', message1);
      expect(consumer.emit).toHaveBeenCalledWith('message_received', message2);
      expect(consumer.emit).toHaveBeenCalledWith('response_processed');
      expect(consumer._processMessage).toHaveBeenCalledWith(message1);
      expect(consumer._processMessage).toHaveBeenCalledWith(message2);
      expect(consumer._deleteMessage).toHaveBeenCalledWith(message1);
      expect(consumer._deleteMessage).toHaveBeenCalledWith(message2);
      expect(consumer._poll).toHaveBeenCalledTimes(1);
    });

    it('should handle authentication error and call _poll after a set delay', async () => {
      const options = {
        queueName: 'test-queue',
        handleMessage: jest.fn(),
        connectionString: 'mockConnectionString'
      };
      
      const consumer = Consumer.create(options);

      consumer.emit = jest.fn();
      consumer.queueService.receiveMessages.mockRejectedValueOnce({ statusCode: 403 });

      await consumer._poll();

      expect(consumer.emit).toHaveBeenCalledWith('error', expect.any(QueueServiceError), undefined);
      expect(consumer._poll).toHaveBeenCalledTimes(1);
    });
  });

  describe('_processMessage method', () => {    
    it('should emit message_received event before calling handleMessage function', async () => {
      const message = { messageId: 'message1' };

      const options = {
        queueName: 'test-queue',
        handleMessage: jest.fn(),
        connectionString: 'mockConnectionString'
      };
      
      const consumer = Consumer.create(options);

      consumer.emit = jest.fn().mockImplementation((event) => {
        if (event === 'message_received') {
          expect(consumer.handleMessage).not.toHaveBeenCalled();
        } else if (event === 'message_processed') {
          expect(consumer.handleMessage).toHaveBeenCalled();
        }
      });

      await consumer._processMessage(message);

      expect(consumer.emit).toHaveBeenCalledWith('message_received', message);
      expect(consumer.handleMessage).toHaveBeenCalledWith(message);
      expect(consumer.emit).toHaveBeenCalledWith('message_processed', message);
      expect(consumer._deleteMessage).toHaveBeenCalledWith(message);
    });

    it('should throw an error if handleMessage function returns an error', async () => {
      const message = { messageId: 'message1' };
      const errorMessage = new Error('test error');

      const options = {
        queueName: 'test-queue',
        handleMessage: jest.fn().mockImplementation((message, callback) => {
          callback(errorMessage);
        }),
        connectionString: 'mockConnectionString'
      };
      
      const consumer = Consumer.create(options);

      consumer.emit = jest.fn();

      await expect(consumer._processMessage(message)).rejects.toThrowError(errorMessage);
      expect(consumer.emit).toHaveBeenCalledWith('processing_error', errorMessage, message);
    });

    it('should handle errors during message processing and emit an error or processing_error event depending on the error name', async () => {
      const message = { messageId: 'message1' };
      const queueServiceError = new QueueServiceError('test error');
      const processingError = new Error('test error 2');

      const options = {
        queueName: 'test-queue',
        handleMessage: jest.fn(),
        connectionString: 'mockConnectionString'
      };
      
      const consumer = Consumer.create(options);

      consumer.emit = jest.fn();

      consumer._deleteMessage.mockRejectedValueOnce(processingError);
      await expect(consumer._processMessage(message)).rejects.toThrowError(processingError);
      expect(consumer.emit).toHaveBeenCalledWith('processing_error', processingError, message);

      consumer._deleteMessage.mockRejectedValueOnce(queueServiceError);
      await expect(consumer._processMessage(message)).rejects.toThrowError(queueServiceError);
      expect(consumer.emit).toHaveBeenCalledWith('error', queueServiceError, message);
    });
  });

})
