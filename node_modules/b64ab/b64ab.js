var b64ab = {};

b64ab.char2bits = {
  0: "110100", 1: "110101", 2: "110110", 3: "110111", 4: "111000",
  5: "111001", 6: "111010", 7: "111011", 8: "111100", 9: "111101",
  A: "000000", Q: "010000", g: "100000", w: "110000", B: "000001",
  R: "010001", h: "100001", x: "110001", C: "000010", S: "010010",
  i: "100010", y: "110010", D: "000011", T: "010011", j: "100011",
  z: "110011", E: "000100", U: "010100", k: "100100", F: "000101",
  V: "010101", l: "100101", G: "000110", W: "010110", m: "100110",
  H: "000111", X: "010111", n: "100111", I: "001000", Y: "011000",
  o: "101000", J: "001001", Z: "011001", p: "101001", K: "001010",
  a: "011010", q: "101010", L: "001011", b: "011011", r: "101011",
  M: "001100", c: "011100", s: "101100", N: "001101", d: "011101",
  t: "101101", O: "001110", e: "011110", u: "101110", "+": "111110",
  P: "001111", f: "011111", v: "101111", "/": "111111"
};

b64ab.toArrayBuffer = function toArrayBuffer (b64) {
  var char2bits = b64ab.char2bits;
  var eqct = 0;
  for (let i = b64.length; i >= 0; i--) if (b64[i] === "=") eqct++;
  var slen = (b64.length - eqct);
  var l = Math.floor(.75 * slen);
  var u8 = new Uint8Array(l);
  var s = "";
  for (var i = 0; i < slen; i++) {
    var char = b64[i];
    if (char === "=") break;
    s += char2bits[char];
    if (s.length >= 8) {
      u8[Math.floor(.75 * i)] = parseInt(s.substring(0, 8), 2);
      s = s.substring(8);
    }
  }
  return u8.buffer;
};

b64ab.toBase64String = function toBase64String(ab) {
  if (!b64ab.bits2char) {
    b64ab.bits2char = {};
    for (let char in b64ab.char2bits) b64ab.bits2char[b64ab.char2bits[char]] = char;
  }
  var bits2char = b64ab.bits2char;
  var u8 = new Uint8Array(ab);
  var s = "";
  var b = "";
  for (var i = 0; i < u8.length; i++) {
    var n = u8[i].toString(2);
    while (n.length < 8) n = "0" + n;
    b += n;
    while (b.length >= 6) {
      s += bits2char[b.substring(0, 6)];
      b = b.substring(6);
    }
  }
  if (b.length > 0) {
    while (b.length < 6) b += "0";
    s += bits2char[b];
  }
  while (s.length % 4 !== 0) {
    s += "="
  }
  return s;
};

if (typeof define === "function" && define.amd) {
  define(function() { return b64ab })
}

if (typeof module === "object") module.exports = b64ab;
if (typeof window === "object") window.b64ab = b64ab;
if (typeof self === "object") self.b64ab = b64ab;
