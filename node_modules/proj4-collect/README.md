# proj4-collect
Collect and Merge all Available Proj4 Instances.  Includes [proj4-fully-loaded](https://github.com/DanielJDufour/proj4-fully-loaded)

## install
```sh
npm install proj4-collect
```

## usage
```js
import proj4collect from "proj4-collect";

// window.proj4 = ...

// finds all global proj4 instances
const proj4 = proj4collect();
```