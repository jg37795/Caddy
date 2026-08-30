/* TEMP: wrap render3D path — catch the exception that blanks later frames. */
'use strict';
const path = require('path');
process.env.EXAG = '12';
const origLog = console.log;
require(path.join(__dirname, 'tmp_real_harness.js'));
