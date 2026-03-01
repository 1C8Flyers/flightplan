import deserialize from "./deserialize.js";
import serialize from "./serialize.js";
import { DEFAULT_FUNCTION_PREFIX, DEFAULT_PROMISE_PREFIX } from "./enums.js";
import { InternalError, MethodNotFound } from "./errors.js";

export default function expose(obj, options) {
  let batch_size = options && typeof options.batch_size === "number" ? options.batch_size : 1;
  let batch_wait = options && typeof options.batch_wait === "number" ? options.batch_wait : Infinity; // 10ms
  const debug_level = options && options.debug_level;

  const all_funcs = {};

  const onmessage = async evt => {
    let { data } = evt;

    if (debug_level >= 2) console.log("[microlink.expose] received message data", data);

    if (Array.isArray(data) && data.length >= 1 && data[0].jsonrpc === "2.0" && data[0].method) {
      if (debug_level >= 2) console.log("[microlink.call] top thread received batch request");
      if (!all_funcs) throw new Error("[microlink.call] no callable functions");
      const results = await Promise.all(
        data.map(async req => {
          if (typeof all_funcs[req.method] !== "function") {
            return MethodNotFound({ id: req.id, method: req.method });
          }
          try {
            const result = await all_funcs[req.method](...req.params);
            return { jsonrpc: "2.0", result, id: req.id };
          } catch (error) {
            return InternalError({ id, error });
          }
        })
      );
      if (debug_level >= 2) console.log("[microlink.call] exposed thread posting results to main thread:", results);
      return postMessage(results);
    }

    if (typeof data !== "object") return;

    if (data.jsonrpc !== "2.0") return;

    if (!data.method) return;

    const { id, method, params } = evt.data;

    if (method === "microlink.list") {
      if (debug_level >= 2) console.log("[microlink.expose] posting method names", data);
      return postMessage({
        jsonrpc: "2.0",
        result: Object.keys(obj),
        id
      });
    }

    if (typeof obj[method] !== "function") {
      if (debug_level >= 2) console.error("[microlink.expose] method not found: " + method);
      return postMessage(MethodNotFound({ id, method }));
    }

    try {
      // batching applies to messsages posted up
      const deserialized_params = deserialize(self, params, 2, { batch_size, batch_wait });
      const result = await obj[method](...deserialized_params);

      const [serialized_result, funcs] = serialize(result, { function_prefix: DEFAULT_FUNCTION_PREFIX, promise_prefix: DEFAULT_PROMISE_PREFIX });
      if (debug_level >= 2) console.log("[microlink.expose]", method, "result", result, "serialized to", [serialized_result, funcs]);
      Object.assign(all_funcs, funcs);

      // encode result in case it returns a function or promise

      if (debug_level >= 2) console.log("[microlink.expose] posting serialized result for " + method + ": " + JSON.stringify(serialized_result));
      return postMessage({
        jsonrpc: "2.0",
        result: serialized_result,
        id
      });
    } catch (error) {
      console.error("[microlink.expose] error:", error);
      return postMessage(InternalError({ error, id }));
    }
  };

  // unblock main thread of worker
  addEventListener("message", evt => {
    setTimeout(() => onmessage(evt), 0);
  });
}
