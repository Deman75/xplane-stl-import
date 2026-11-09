/* Small ZIP32 writer: stored entries, UTF-8 names, no third-party dependencies. */
(function (root) {
  'use strict';
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  function crc32(data) { let c = 0xffffffff; for (const b of data) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function makeZip(files) {
    if (files.length > 65535) throw new Error('Слишком много файлов для ZIP32.');
    const chunks = [], central = [], paths = new Set(); let offset = 0, centralSize = 0;
    for (const file of files) {
      const path = file.name.replace(/\\/g, '/');
      if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').some(s => !s || s === '.' || s === '..')) throw new Error('Недопустимый путь ZIP.');
      const name = new TextEncoder().encode(path), data = file.data;
      if (!(data instanceof Uint8Array) || data.length > 0xffffffff || name.length > 65535) throw new Error('Недопустимый размер ZIP.');
      if (paths.has(path.toLowerCase())) throw new Error('Повторяющийся файл ZIP: ' + path);
      paths.add(path.toLowerCase());
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
      l.setUint16(12, 33, true); l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
      const dir = new Uint8Array(46 + name.length), d = new DataView(dir.buffer);
      d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true);
      d.setUint16(14, 33, true); d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); dir.set(name, 46);
      chunks.push(local, data); central.push(dir); offset += local.length + data.length; centralSize += dir.length;
      if (offset + centralSize + 22 > 0xffffffff) throw new Error('Архив слишком большой для ZIP32.');
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end], { type: 'application/zip' });
  }
  root.OfflineZip = { makeZip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = { makeZip, crc32 };
})(globalThis);
