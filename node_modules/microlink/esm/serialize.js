import { DEFAULT_FUNCTION_PREFIX, DEFAULT_PROMISE_PREFIX } from "./enums.js";

/**
 * @name serialize
 * @description convert functions and promises at any level of nesting to strings
 * @param {any} it
 * @param {String} prefix - add to beginning of function ids
 * @returns [it, funcs]
 */
export default function serialize(things, { function_prefix = DEFAULT_FUNCTION_PREFIX, promise_prefix = DEFAULT_PROMISE_PREFIX } = {}, generate_id) {
  const funcs = {};
  const proms = {};

  if (!generate_id) generate_id = () => Math.random();

  function stringify(it) {
    if (Array.isArray(it)) {
      return it.map(i => stringify(i));
    } else if (typeof it === "function") {
      const fid = generate_id(it);
      funcs[fid] = it;
      return function_prefix + fid;
    } else if (typeof it === "object" && it !== null && typeof it.then === "function") {
      const pid = generate_id(it);
      proms[pid] = it;
      funcs[pid] = () => it; // create function that returns the promise
      return promise_prefix + pid;
    } else if (typeof it === "object" && it !== null && it.constructor.name.indexOf("Array") === -1) {
      // object that is not null nor a typed array
      return Object.fromEntries(Object.entries(it).map(([k, v]) => [k, stringify(v)]));
    } else {
      return it;
    }
  }

  things = stringify(things);

  return [things, funcs, proms];
}
