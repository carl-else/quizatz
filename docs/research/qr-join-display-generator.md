# QR Generator for the Join Display

## Decision

Use [`qr-code-styling`](https://github.com/kozakdenys/qr-code-styling) for the
browser-only QR join display. Pin a current compatible release when the
implementation ticket is created.

The library's published package metadata declares TypeScript definitions in
`lib/index.d.ts`, has an MIT license, and depends only on
[`qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator).
Its official API supports browser rendering as SVG or canvas, appending to a
DOM element, and QR correction levels `L`, `M`, `Q`, and `H`. Its repository
also provides an official Vue example.

Sources:

- [Package metadata](https://github.com/kozakdenys/qr-code-styling/blob/master/package.json)
- [Official API and Vue example](https://github.com/kozakdenys/qr-code-styling#api-documentation)
- [MIT license](https://github.com/kozakdenys/qr-code-styling/blob/master/LICENSE)

## Required Use

Generate an SVG QR code containing the existing public live-session join URL.
Use a plain square, dark-on-light code with no logo, image, gradient, or
decorative module shape. Select correction level `Q`, retain an adequate quiet
zone, and size the SVG for scanning from the intended display distance.

The QR image is not an accessible substitute for the join URL. The display
must also expose the complete join URL as a normal text link with a clear
accessible name.

## Alternatives Considered

[`qrcode`](https://github.com/soldair/node-qrcode) is a viable MIT-licensed
browser library. Its official documentation supports browser use through a
module bundler, SVG output through `toString({ type: "svg" })`, and correction
levels `L`, `M`, `Q`, and `H`. However, its repository is JavaScript and its
own documentation refers TypeScript users to the separate `@types/qrcode`
package. Its most recent release is older than the selected library's current
release. It is a reasonable fallback if the implementation prefers its smaller
API over `qr-code-styling`'s direct TypeScript declarations and official Vue
example.

[`html5-qrcode`](https://github.com/mebjas/html5-qrcode) was rejected because
its official documentation describes camera and image QR/barcode scanning, not
generating a QR code for display.

Sources:

- [`qrcode` browser API and correction levels](https://github.com/soldair/node-qrcode#browser)
- [`qrcode` SVG output API](https://github.com/soldair/node-qrcode#tostringtext-options-cberror-string)
- [`qrcode` TypeScript note](https://github.com/soldair/node-qrcode#binary-data)
- [`html5-qrcode` official repository](https://github.com/mebjas/html5-qrcode)