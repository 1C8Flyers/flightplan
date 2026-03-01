const merge = require("proj4-merge");
const _proj4 = require("proj4");
const proj4_fully_loaded = require("proj4-fully-loaded");

function proj4collect(instances) {
  if (!instances) instances = [];

  if (_proj4) instances.push(_proj4);

  if (proj4_fully_loaded) instances.push(proj4_fully_loaded);

  if (typeof global === "object" && global.proj4) instances.push(global.proj4);

  if (typeof globalThis === "object" && globalThis.proj4) instances.push(globalThis.proj4);

  if (typeof self === "object" && self.proj4) instances.push(self.proj4);

  if (typeof window === "object" && window.proj4) instances.push(window.proj4);

  // filters out nullish values and empty objects
  // sometimes you'll have a null object if using webpack's null-loader
  instances = instances.filter(it => ![undefined, null].includes(it) && (typeof it !== "object" || Object.keys(it).length > 0));

  const merged = merge(instances);

  return merged;
}

if (typeof define === "function" && define.amd) {
  define(function () {
    return proj4collect;
  });
}

if (typeof module === "object") {
  module.exports = proj4collect;
  module.exports.default = proj4collect;
}

if (typeof window === "object") {
  window.proj4collect = proj4collect;
}

if (typeof self === "object") {
  self.proj4collect = proj4collect;
}
