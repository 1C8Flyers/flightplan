# get-constructor-name
Get the Name of a JavaScript Function's Constructor.  Returns String or Undefined.

## features
- guaranteed to return string or undefined
- doesn't throw errors

## install
```bash
npm install get-constructor-name
```

## usage
```js
import getConstructorName from "get-constructor-name";

const arrayBuffer = new ArrayBuffer();

getConstructorName(arrayBuffer) // ArrayBuffer
getConstructorName(100) // undefined
getConstructorName(null) // undefined
```