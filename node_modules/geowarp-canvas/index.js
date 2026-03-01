const calcImageStats = require("calc-image-stats");
const guessImageLayout = require("guess-image-layout");
const { rawToRgba } = require("pixel-utils");

// decorator adding canvas support to geowarp
function geowarp_canvas(geowarp) {
  return function ({
    plugins = [],
    out_canvas, // canvas that has a height and width set
    in_stats,
    out_no_data_color,
    out_resolution = [1, 1], // 1 = full resolution, 0.5 sample for half as many pixels across
    draw,
    before_draw,
    after_draw,
    before_warp,
    after_warp,
    palette,
    flip,
    ...rest
  }) {
    // don't activate plugin
    if (!plugins.includes("canvas")) {
      return geowarp({ ...rest, plugins, in_stats });
    }

    if (typeof out_canvas.height !== "number") throw Error("[geowarp-canvas] out_canvas.height not set");
    if (typeof out_canvas.width !== "number") throw Error("[geowarp-canvas] out_canvas.width not set");

    // shallow clone of geowarp options
    const options = { ...rest };

    let [x_resolution, y_resolution] = out_resolution;

    options.debug_level = Math.max(0, options.debug_level || 0);
    options.out_pixel_depth = 4;

    options.out_height = Math.round(out_canvas.height * y_resolution);
    options.out_width = Math.round(out_canvas.width * x_resolution);

    // re-adjust resolution according to pixel necessary rounding
    x_resolution = options.out_width / out_canvas.width;
    y_resolution = options.out_height / out_canvas.height;

    const scale = [1 / x_resolution, 1 / y_resolution];

    const out_context = out_canvas.getContext("2d");

    // don't try to render pixels that have one or more no data values
    options.skip_no_data_strategy ??= "any";

    // don't try to insert null values when expr returns null
    options.insert_null_strategy = "skip";

    if (!options.expr) {
      if (palette) {
        if (typeof palette[pixel[0]] === "string") {
          options.expr = ({ pixel }) => palette[pixel[0]];
        } else if (palette[0].length === 3) {
          options.expr = ({ pixel }) => `rgb(${palette[pixel[0]].join(", ")})`;
        } else if (palette[0].length === 4) {
          options.expr = ({ pixel }) => {
            const [r, g, b, a] = palette[pixel[0]];
            return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
          };
        }
      } else {
        if (options.debug_level >= 1) console.log("[geowarp-canvas] creating expr function that fits pixels to 0-255 color space");

        const guessed = guessImageLayout({
          data: options.in_data,
          height: options.in_height,
          width: options.in_width
        });
        options.in_pixel_depth ??= guessed.bands;
        options.in_height ??= guessed.height;
        options.in_width ??= guessed.width;

        flip ??= options.in_pixel_depth === 1;

        in_stats ??= calcImageStats(options.in_data, {
          height: options.in_height,
          noData: options.in_no_data,
          stats: ["min", "max"],
          width: options.in_width
        }).bands;

        const rawToRgbaFn = rawToRgba({
          debug_level: options.debug_level,
          format: "string",
          ranges: in_stats.map(band => [band.min, band.max]),
          flip,
          no_data_strategy: "all",
          no_range_value_strategy: flip ? "highest" : "lowest",
          old_no_data_value: options.in_no_data
        });
        if (options.debug_level >= 2) console.log("[geowarp-canvas] created a function for converting from raw pixel values to RGBA");

        options.expr = ({ pixel }) => rawToRgbaFn(pixel);
      }
    }

    let image_data;

    options.insert_sample = function ({
      pixel: color,
      row,
      column,
      raw,

      // the following are currently only provided by geowarp when using "near" resampling
      pt_in_srs,
      pt_out_srs,
      x_in_raster_pixels,
      y_in_raster_pixels
    }) {
      if (color === null || color === undefined) return;

      if (Array.isArray(color)) {
        const len = color.length;
        if (len === 3) {
          const [r, g, b] = color;
          color = `rgb(${r},${g},${b})`;
        } else if (len === 4) {
          const [r, g, b, a] = color;
          color = `rgba(${r},${g},${b},${a / 255})`;
        }
      }

      out_context.fillStyle = color;

      const xmin = column / x_resolution;
      const ymin = row / y_resolution;

      const xmax = (column + 1) / x_resolution;
      const ymax = (row + 1) / y_resolution;

      const xmin_rounded = Math.round(xmin);
      const ymin_rounded = Math.round(ymin);

      const width = Math.round(xmax) - xmin_rounded;
      const height = Math.round(ymax) - ymin_rounded;

      const draw_options = {
        bbox: [xmin, ymin, xmax, ymax],
        canvas: out_canvas,
        color,
        context: out_context,
        data: options.in_data,
        pixel: raw,
        rect: [xmin_rounded, ymin_rounded, width, height],
        resolution: out_resolution,
        cell: [column, row],
        scale,
        points: [pt_in_srs, pt_out_srs],
        sample: [x_in_raster_pixels, y_in_raster_pixels]
      };

      if (typeof before_draw === "function") {
        before_draw(draw_options);
      }

      if (typeof draw === "function") {
        draw(draw_options);
      } else {
        out_context.fillRect(xmin_rounded, ymin_rounded, width, height);
      }

      if (typeof after_draw === "function") {
        after_draw(draw_options);
      }
    };

    if (typeof out_no_data_color === "string") {
      out_context.fillStyle = out_no_data_color;
      out_context.fillRect(0, 0, out_canvas.width, out_canvas.height);
    }

    if (options.debug_level >= 2) {
      console.log("[geowarp-canvas] calling geowarp with the following options:", options);
    }

    out_context.save();

    if (typeof before_warp === "function") before_warp(options);

    const result = geowarp(options);

    if (typeof after_warp === "function") after_warp(result);

    if (image_data) out_context.putImageData(image_data, 0, 0);

    // reset context
    out_context.restore();

    // add canvas to result
    result.canvas = out_canvas;

    return result;
  };
}

if (typeof define === "function" && define.amd) {
  define(function () {
    return geowarp_canvas;
  });
}

if (typeof module === "object") {
  module.exports = geowarp_canvas;
  module.exports.default = geowarp_canvas;
}

if (typeof window === "object") {
  window.geowarp_canvas = geowarp_canvas;
}
