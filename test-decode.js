// node test-decode.js — falla si decode() deja entidades HTML sin traducir
const assert = require('assert');
const { decode } = require('./scrape.js');

assert.strictEqual(decode('aves cremosas &mdash; risotto de camarones'), 'aves cremosas — risotto de camarones');
assert.strictEqual(decode('Carmén&egrave;re br&ucirc;l&eacute; &Ntilde;u&ntilde;oa'), 'Carménère brûlé Ñuñoa');
assert.strictEqual(decode('12&deg; &laquo;a&raquo; M&uuml;ller &ndash; &hellip;'), '12° «a» Müller – …');
assert.strictEqual(decode('&amp;quot;doble&amp;quot;'), '"doble"'); // doble codificación
assert.strictEqual(decode('&#8212; &#x2014; &desconocida;'), '— — &desconocida;');
console.log('decode OK');
