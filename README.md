# azure-queue-subscriber

This package allows you to consume messages from an Azure Queue using Node.js.

## Installation

To use this package, you can install it via npm:

```bash
npm install azure-queue-subscriber
```

## Usage

First, require the package in your Node.js file:

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
- `batchSize`: (Optional) The number of messages to retrieve at a time. Defaults to 1.
- `pollDelaySeconds`: (Optional) The number of seconds to wait between each poll of the queue. Defaults to 1.
- `maximumExecutionTimeSeconds`: (Optional) The maximum amount of time (in seconds) that a message can be locked for processing. Defaults to 10.
- `authenticationErrorTimeoutSeconds`: (Optional) The amount of time (in seconds) to wait before retrying after an authentication error. Defaults to 10.
- `queueService`: (Optional) An instance of the `QueueClient` class from the `@azure/storage-queue` package. This is optional and can be used if you need more control over the queue service.
- `maximumRetries`: (Optional) The total number of retries for failed jobs before they are deleted from the queue.
- `useLogtailLogger`: (Optional) Whether to use Logtail for logging. Defaults to `false`.
- `logtailKey`: (Optional) The Logtail API key. Required if `useLogtailLogger` is `true`.
- `loggerService`: (Optional) An instance of the Logtail logger service. Required if `useLogtailLogger` is `true`.

### Methods

#### start()

Starts the consumer, which begins polling the queue for messages.

```javascript
consumer.start();
```

#### stop()

Stops the consumer.

```javascript
consumer.stop();
```

### Events

The `Consumer` class is an `EventEmitter`, which means that you can listen for events that are emitted by the class. The following events are available:

- `message_processed`: Emitted when a message has been processed successfully. The message object is passed as the argument to the event listener.
- `processing_error`: Emitted when there is an error processing a message. The error object and message object are passed as arguments to the event listener.
- `error`: Emitted when there is an error that is not related to processing a message. The error object is passed as the argument to the event listener.
- `stopped`: Emitted when the consumer has been stopped.
- `starting listening process`: Emitted when the consumer is starting to listen to the queue for messages.
- `No messages available to be processed`: Emitted when the queue is empty.

### Logtail
To use `Logtail` as for external logging, please refer to the logtail [documentation](https://betterstack.com/docs/logs/javascript/install/) for detailed instructions on how to setup your logging console and key.

### Example

Here's an example of how to use the `Consumer` class:

```javascript
const Consumer = require('azure-queue-subscriber');

const consumer = new Consumer({
  connectionString: '<your-storage-account-connection-string>',
  queueName: '<your-queue-name>',
  handleMessage: async (message, done) => {
    console.log('Received message:', message.messageText);
    // Process message here
    done(); // Call done() to indicate that message processing is complete
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
This node package is an adaptation of  [azure-queue-consumer](https://www.npmjs.com/package/azure-queue-consumer)

