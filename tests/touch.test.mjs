// run: node tests/touch.test.mjs
import assert from 'node:assert/strict';
import { stickVector } from '../src/touch.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
let v = stickVector(3, 3, 60); assert.deepEqual([v.x, v.y, v.mag], [0, 0, 0], 'inside the dead zone');
v = stickVector(0, -60, 60); near(v.x, 0); near(v.y, 1); near(v.mag, 1); // straight up = full forward
v = stickVector(600, 0, 60); near(v.x, 1); near(v.raw, 1); // clamped past the ring
v = stickVector(-30, 0, 60); assert.ok(v.x < 0 && v.x > -1, 'left is negative x'); near(v.raw, 0.5);
v = stickVector(0, 60, 60); near(v.y, -1); // pulling down = backward
console.log('touch tests passed');
