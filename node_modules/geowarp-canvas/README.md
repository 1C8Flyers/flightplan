# geowarp-canvas

## motivation
Make it easier to display geospatial data on an HTML Canvas Element

## design philosophy
geowarp-canvas is designed as a decorator.  This library is highly experimental, so this may change in the future.  The idea is to find a way to add capabilities to geowarp without adding too much complexity to geowarp core.

## usage
```js
import geowarp_core from "geowarp";
import geowarp_canvas from "geowarp-canvas";

const geowarp = geowarp_canvas(geowarp_core);

const canvas = document.createElement("CANVAS");
canvas.height = 256;
canvas.width = 256;

geowarp({
  // required
  // activate geowarp-canvas plugin
  plugins: ["geowarp-canvas"],

  // required
  // this is the canvas that we will paint on
  out_canvas: canvas,

  // optional
  // array of statistics by band
  // could greatly increase speed
  in_stats: [{ min: 0, max: 12345 }, { min: 0, max: 10567 }],

  // optional
  // paint the background of the canvas this color
  // before painting valid data
  out_no_data_color: "pink",

  // optional - experimental
  // draw at a quarter of the real resolution
  out_resolution: [0.25, 0.25],

  // optional
  // custom draw function
  draw: ({ 
    bbox: [xmin, ymin, xmax, ymax], // location of pixel rectangble in un-rounded canvas image coordinates from top-left
    canvas, // same as out_canvas, the canvas you are painting to
    context, // context for the out_canvas
    color, // CSS Color Value, like "rgba(0, 12, 54, 255)"
    pixel, // raw pixel values (before band expression applied)
    rect: [x, y, width, height], // params for fillRect or strokeRect
    rgba, // pixel as [r, g, b, a]
    cell: [row, column], // cell location at current resolution
    resolution: [x_resolution, y_resolution],
    scale: [x_scale, y_scale],
    points: [source_point, target_point], // pixel centroid in projection of data and canvas, only available when method is "near" and turbo is false
    sample: [column_in_data, row_in_data]
  }) => {
    context.fillStyle(color);
    context.fillRect(...rect);
  },

  // optional
  // called with mutable options object that will be passed to geowarp
  before_warp: (options) => {
    const { expr, out_height, skip_no_data_strategy, ...rest } = options;
    // ...
  },

  // optional
  // called after warping with result returned by geowarp
  after_warp: (result) => {
    console.log("result returned by geowarp:", result);
  },

  // optional
  // paint or modify the canvas before
  // drawing the rectangle for the reprojected pixel
  before_draw: ({ bbox, ...rest }) => { },

  // optional
  after_draw: ({ bbox, canvas, context, color, pixel, point, rect, rgba, resolution, scale }) => {
    // put red outline around drawn pixel rectangle
    context.strokeStyle = "red";
    context.strokeRect(...rect);
  },

  // optional
  // array of colors where each index number corresponds to a pixel value
  // each color can be [r, g, b, a], [r, g, b] or "rgb(112, 108, 96)" (CSS Color Values)
  palette: [
    [ 112, 108, 96, 255 ],
    [ 112, 104, 80, 255 ]
    // ...
  ],

  // flip between black-to-white and white-to-black
  flip: true

  // all other params are inherited from
  // https://github.com/danieljdufour/geowarp
});
```
