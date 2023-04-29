
# azure-queue-subscriber

This package allows you to consume messages from an Azure Queue using Node.js.

## Usage

To use this package, you must first install it and then require it in your Node.js file:

```bash
npm install azure-queue-subscriber
```

```javascript
const Consumer = require('azure-queue-subscriber');
```

The package provides a `Consumer` class that you can use to consume messages from a queue.

### Constructor

```javascript
const consumer = new Consumer(options);
```

The `options` parameter is an object that contains the following properties:

- `connectionString`: The connection string for the Azure Storage account that contains the queue.
- `queueName`: The name of the queue to consume messages from.
- `handleMessage`: A callback function that will be called for each message received from the queue.
- `batchSize`: The number of messages to retrieve at a time. Defaults to 1.
- `pollDelaySeconds`: The number of seconds to wait between each poll of the queue. Defaults to 1.
- `maximumExecutionTimeSeconds`: The maximum amount of time (in seconds) that a message can be locked for processing. Defaults to 10.
- `authenticationErrorTimeoutSeconds`: The amount of time (in seconds) to wait before retrying after an authentication error. Defaults to 10.
- `queueService`: An instance of the `QueueClient` class from the `@azure/storage-queue` package. This is optional and can be used if you need more control over the queue service.

### Methods

#### `start()`

Starts the consumer, which begins polling the queue for messages.

```javascript
consumer.start();
```

#### `stop()`

Stops the consumer.

```javascript
consumer.stop();
```

### Events

The `Consumer` class is an `EventEmitter`, which means that you can listen for events that are emitted by the class. The following events are available:

- `message_processed`: Emitted when a message has been processed successfully. The message object is passed as the argument to the event listener.
- `processing_error`: Emitted when there is an error processing a message. The error object and message object are passed as the arguments to the event listener.
- `error`: Emitted when there is an error that is not related to processing a message. The error object is passed as the argument to the event listener.
- `stopped`: Emitted when the consumer has been stopped.
- `starting listening process`: Emitted when the consumer is starting to listen to the queue for messages
- `No messages availabe to be processed`: Emitted when the queue is empty

## Example

```javascript
const Consumer = require('azure-queue-subscriber');

const consumer = new Consumer({
  connectionString: '<your-storage-account-connection-string>',
  queueName: '<your-queue-name>',
  handleMessage: async (message) => {
    console.log('Received message:', message.messageText);
    // Process message here
  }
});

consumer.on('message_processed', (message) => {
  console.log('Message processed:', message.messageText);
});

consumer.on('processing_error', (err, message) => {
  console.error('Error processing message:', err, message.messageText);
});

consumer.on('error', (err) => {
  console.error('Error:', err);
});

consumer.start();
```


### Credits
This node package is an adaptation of  [azure-queue-consumer](https://github.com/bbc/azure-queue-consumer)

