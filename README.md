# azure-queue-subscriber


//

## Installation

```bash
npm install azure-queue-subscriber --save
```

## Usage

```js
const Consumer = require('azure-queue-subscriber');

const app = Consumer.create({
  queueUrl: 'https://account-name.queue.core.windows.net/queue-name',
  handleMessage: (message, done) => {
    // do some work with `message`
    done();
  }
});

app.on('error', (err) => {
  console.log(err.message);
});

app.start();
```

* The queue is polled every second by default.
* Messages are deleted from the queue once `done()` is called.
* Messages are processed one at a time.

### Credentials





## API

### `Consumer.create(options)`

Creates a new Azure data queue consumer.

#### Options

* `queueUrl` - _String_ - The Azure data queue URL


### `consumer.start()`

Start polling the queue for messages.

### `consumer.stop()`

Stop polling the queue for messages.

### Events

Each consumer is an [`EventEmitter`](http://nodejs.org/api/events.html) and emits the following events:



### Credits

