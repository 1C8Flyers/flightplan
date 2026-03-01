# microlink
> Comlink Alternative

## features
- easily pass functions to worker threads
- built with [JSON-RPC 2.0](https://www.jsonrpc.org/specification)
- zero run-time dependencies
- await promise in another thread
- batching

## usage
#### inside worker.js
```js
import { expose } from 'microlink';

expose({
  run: (func, args) => func(...args),
  halve: n => n / 2,
});
```

#### inside main.js
```js
import { wrap } from 'microlink';
// or, import wrap from 'microlink/wrap';

const worker = new Worker("worker.js");
const obj = await wrap(worker);

await obj.halve(10);
5

const count_elements = selector => document.querySelectorAll(selector).length;
await obj.run(count_elements, 'div');
```

## advanced usage
#### batching
```js
import { expose } from "microlink";

expose(methods, {
  batch_size: 10, // how many requests per batch should be sent up to the main thread
  batch_wait: 100, // wait up to 100ms for batch to be filled before sent
})
```

#### debugging
```js
// pass an options object to expose or wrap
const options = { debug_level: 10 };

expose(methods, options);
wrap(worker, options)
```
  