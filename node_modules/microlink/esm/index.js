import expose from "./expose.js";
import { default as _serialize } from "./serialize.js";
import wrap from "./wrap.js";

if (typeof window === "object") {
  window.microlink = { expose, wrap, _serialize };
}

if (typeof self === "object") {
  self.microlink = { expose, wrap, _serialize };
}

if (typeof module === "object") {
  module.exports = { expose, wrap, _serialize };
}

if (typeof define === "function" && define.amd) {
  define(function () {
    return { expose, wrap, _serialize };
  });
}
