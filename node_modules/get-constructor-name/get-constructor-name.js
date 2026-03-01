function getConstructorName(obj) {
  try {
    if (typeof obj === "object" && typeof obj.constructor === "function" && typeof obj.constructor.name === "string") {
      if (obj.constructor.name !== "") {
        return obj.constructor.name;
      }
    }
  } catch (error) {
    return undefined;
  }
}

if (typeof define === "function") define(() => getConstructorName);
if (typeof module === "object") module.exports = getConstructorName;
if (typeof window === "object") window.getConstructorName = getConstructorName;
if (typeof self === "object") self.getConstructorName = getConstructorName;