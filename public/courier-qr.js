import qrcode from './assets/vendor/qrcode-generator/qrcode.js';

// Deliberately plain demo text, never a bank payment instruction or account.
export function demoQrPayload(id, amount) {
  return `PIZZA VISI - DEMO ONLY\nORDER ${id}\nAMOUNT CZK ${amount.toFixed(2)}\nNO PAYMENT - NEPROVADEJTE PLATBU`;
}
export function demoQrSvg(id, amount) {
  const code = qrcode(0, 'M');
  code.addData(demoQrPayload(id, amount));
  code.make();
  return code.createSvgTag({cellSize: 5, margin: 20, scalable: true, alt: 'Ukazkovy QR kod, neprovadi platbu'});
}
