import test from 'node:test';
import assert from 'node:assert/strict';
import {FileByteCache} from '../desktop/file-cache.mjs';
test('byte cache enforces LRU bytes/count limits and isolates mutable callers',()=>{
 const cache=new FileByteCache({maxBytes:6,maxEntries:2,maxEntryBytes:4});const b=Buffer.from('abc');
 cache.set('a','1',b);b[0]=0;assert.equal(cache.get('a','1').toString(),'abc');
 const copy=cache.get('a','1');copy[0]=0;assert.equal(cache.get('a','1').toString(),'abc');
 cache.set('b','1',Buffer.from('def'));cache.get('a','1');cache.set('c','1',Buffer.from('ghi'));
 assert.equal(cache.get('b','1'),null);assert.equal(cache.bytes,6);assert.equal(cache.entries.size,2);
 cache.set('huge','1',Buffer.alloc(5));assert.equal(cache.entries.size,2);
 cache.clear();assert.equal(cache.bytes,0);assert.equal(cache.entries.size,0);
});
test('cache expires lazily with no extension on hits and invalidates changed revisions',()=>{
 let now=0;const cache=new FileByteCache({ttl:10,now:()=>now});cache.set('a','1',Buffer.from('a'));
 now=9;assert(cache.get('a','1'));now=10;assert.equal(cache.get('a','1'),null);assert.equal(cache.bytes,0);
 cache.set('a','1',Buffer.from('a'));assert.equal(cache.get('a','2'),null);assert.equal(cache.bytes,0);
});
