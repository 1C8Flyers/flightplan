# b64ab

### install
```js
npm install b64ab
```

### usage
```js
import { toBase64String, toArrayBuffer } from "b64ab";

// create an Array Buffer
const ab = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).buffer;

// convert an Array Buffer to a Base-64 String
toBase64String(ab);
"AQIDBAUGBwgJCg=="

// convert a Base-64 String to an Array Buffer
toArrayBuffer("AQIDBAUGBwgJCg==")
ArrayBuffer {
  [Uint8Contents]: <01 02 03 04 05 06 07 08 09 0a>,
  byteLength: 10
}
```