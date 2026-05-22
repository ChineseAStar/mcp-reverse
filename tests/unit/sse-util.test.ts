/**
 * SSE Utilities — unit tests
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  formatSSEEvent,
  formatSSEComment,
  formatSSEPing,
  SSEParser,
} from '../../src/transport/sse-util.js';

describe('SSE Utilities', () => {
  describe('formatSSEEvent', () => {
    it('should format a simple data event', () => {
      const result = formatSSEEvent('hello');
      assert.strictEqual(result, 'data: hello\n\n');
    });

    it('should format event with type', () => {
      const result = formatSSEEvent('hello', { event: 'message' });
      assert.strictEqual(result, 'event: message\ndata: hello\n\n');
    });

    it('should format event with id', () => {
      const result = formatSSEEvent('hello', { id: '42' });
      assert.strictEqual(result, 'id: 42\ndata: hello\n\n');
    });

    it('should format event with retry', () => {
      const result = formatSSEEvent('hello', { retry: 5000 });
      assert.strictEqual(result, 'retry: 5000\ndata: hello\n\n');
    });

    it('should format event with all fields', () => {
      const result = formatSSEEvent('hello', { event: 'update', id: '1', retry: 3000 });
      assert.match(result, /event: update/);
      assert.match(result, /id: 1/);
      assert.match(result, /retry: 3000/);
      assert.match(result, /data: hello/);
      assert.match(result, /\n\n$/);
    });

    it('should handle multi-line data', () => {
      const result = formatSSEEvent('line1\nline2\nline3');
      assert.match(result, /data: line1\ndata: line2\ndata: line3/);
    });

    it('should produce valid JSON-RPC as SSE', () => {
      const msg = JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
      const result = formatSSEEvent(msg, { event: 'message', id: '1' });
      assert.match(result, /event: message/);
      assert.match(result, /data: \{.*"method":"tools\/list".*\}/);
    });
  });

  describe('formatSSEComment', () => {
    it('should format a comment', () => {
      const result = formatSSEComment('keepalive');
      assert.strictEqual(result, ': keepalive\n\n');
    });
  });

  describe('formatSSEPing', () => {
    it('should format a ping comment with timestamp', () => {
      const result = formatSSEPing();
      assert.match(result, /^: ping \d+\n\n$/);
    });
  });

  describe('SSEParser', () => {
    it('should parse a simple event', () => {
      const parser = new SSEParser();
      const events = parser.feed('data: hello\n\n');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].event, 'message');
      assert.strictEqual(events[0].data, 'hello');
    });

    it('should parse event with type', () => {
      const parser = new SSEParser();
      const events = parser.feed('event: update\ndata: changed\n\n');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].event, 'update');
      assert.strictEqual(events[0].data, 'changed');
    });

    it('should parse event with id', () => {
      const parser = new SSEParser();
      const events = parser.feed('id: 42\ndata: hello\n\n');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].id, '42');
      assert.strictEqual(events[0].data, 'hello');
    });

    it('should handle multiple events in one chunk', () => {
      const parser = new SSEParser();
      const events = parser.feed('data: first\n\ndata: second\n\n');
      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0].data, 'first');
      assert.strictEqual(events[1].data, 'second');
    });

    it('should handle chunked input (partial events)', () => {
      const parser = new SSEParser();

      let events = parser.feed('data: hel');
      assert.strictEqual(events.length, 0, 'no events on partial chunk');

      events = parser.feed('lo\n\n');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].data, 'hello');
    });

    it('should handle chunk split at newline boundary', () => {
      const parser = new SSEParser();

      let events = parser.feed('data: first\n');
      assert.strictEqual(events.length, 0);

      events = parser.feed('\ndata: second\n\n');
      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0].data, 'first');
      assert.strictEqual(events[1].data, 'second');
    });

    it('should ignore comment-only blocks (keepalive)', () => {
      const parser = new SSEParser();
      const events = parser.feed(': keepalive\n\n');
      assert.strictEqual(events.length, 0, 'comment-only blocks should be ignored');
    });

    it('should ignore comments but keep data from mixed blocks', () => {
      const parser = new SSEParser();
      const events = parser.feed(': comment\ndata: hello\n\n');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].data, 'hello');
    });

    it('should parse multi-line data', () => {
      const parser = new SSEParser();
      const events = parser.feed('data: line1\ndata: line2\ndata: line3\n\n');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].data, 'line1\nline2\nline3');
    });

    it('should parse retry field', () => {
      const parser = new SSEParser();
      const events = parser.feed('retry: 5000\ndata: hello\n\n');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].retry, 5000);
    });

    it('should handle JSON-RPC payloads', () => {
      const parser = new SSEParser();
      const msg = JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: {}, id: 1 });
      const events = parser.feed(`event: message\ndata: ${msg}\n\n`);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].event, 'message');
      const parsed = JSON.parse(events[0].data);
      assert.strictEqual(parsed.method, 'tools/call');
    });

    it('should reset correctly', () => {
      const parser = new SSEParser();
      parser.feed('data: partial');
      parser.reset();
      const events = parser.feed('data: fresh\n\n');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].data, 'fresh');
    });

    it('should handle empty field values (field with no colon)', () => {
      const parser = new SSEParser();
      const events = parser.feed('data\n\n');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].data, '\n');
    });

    it('should handle field value with leading space stripped', () => {
      const parser = new SSEParser();
      const events = parser.feed('data: hello world\n\n');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].data, 'hello world');
    });

    it('should handle field value with colons', () => {
      const parser = new SSEParser();
      const events = parser.feed('data: time: 12:30:45\n\n');
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].data, 'time: 12:30:45');
    });
  });
});
