import batch from "./batch.js";
import batchcall from "./batchcall.js";
import { DEFAULT_FUNCTION_PREFIX, DEFAULT_PROMISE_PREFIX } from "./enums.js";

// const cache = {};

export default function deserialize(it, inpt, depth = 1, { batch_size = 1, batch_wait = 10, debug_level = 0 } = {}) {
  if (Array.isArray(inpt)) {
    if (depth >= 0) {
      return inpt.map(param => deserialize(it, param, depth - 1, { batch_size, batch_wait }));
    } else {
      return inpt;
    }
  } else if (typeof inpt === "object" && inpt !== null && inpt.constructor.name.indexOf("Array") === -1) {
    const obj = {};
    for (let key in inpt) {
      obj[key] = deserialize(it, inpt[key], depth - 1, { batch_size, batch_wait });
    }
    return obj;
  } else if (typeof inpt === "string" && inpt.startsWith(DEFAULT_FUNCTION_PREFIX)) {
    const method = inpt.replace(DEFAULT_FUNCTION_PREFIX, "");
    const runInBatch = batch(
      params => {
        return batchcall(it, params, { debug_level });
      },
      { size: batch_size, wait: batch_wait }
    );
    return function () {
      const params = Array.from(arguments);
      return runInBatch({ method, params });
    };
    // return async function () {
    //   const params = Array.from(arguments);
    //   // const str = JSON.stringify(params); // adding overhead??
    //   // if (!(str in cache)) {
    //   //   cache[str] = runInBatch({ method, params });
    //   // }
    //   // return cache[str];
    //   return runInBatch({ method, params });
    // };
  } else if (typeof inpt === "string" && inpt.startsWith(DEFAULT_PROMISE_PREFIX)) {
    const method = inpt.replace(DEFAULT_PROMISE_PREFIX, "");
    const runInBatch = batch(
      params => {
        return batchcall(it, params, { debug_level });
      },
      { size: batch_size, wait: batch_wait }
    );
    return runInBatch({ method, params: [] });
  } else {
    return inpt;
  }
}
