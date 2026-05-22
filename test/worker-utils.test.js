/**
 * Tests for Cloudflare Worker utility functions.
 * Requires Node 18+ (native WebCrypto via globalThis.crypto).
 */
import { describe, it, expect } from 'vitest';
import { isPrivateHostname, timingSafeEqual } from '../workers/cherry-proxy/src/index.js';

describe('isPrivateHostname', () => {
  it('blocks localhost', () => {
    expect(isPrivateHostname('localhost')).toBe(true);
  });

  it('blocks .local TLD', () => {
    expect(isPrivateHostname('mydevbox.local')).toBe(true);
  });

  it('blocks .internal TLD', () => {
    expect(isPrivateHostname('db.internal')).toBe(true);
  });

  it('blocks IPv6 loopback ::1', () => {
    expect(isPrivateHostname('::1')).toBe(true);
    expect(isPrivateHostname('[::1]')).toBe(true);
  });

  it('blocks 127.x.x.x loopback', () => {
    expect(isPrivateHostname('127.0.0.1')).toBe(true);
    expect(isPrivateHostname('127.1.2.3')).toBe(true);
  });

  it('blocks 10.x.x.x private', () => {
    expect(isPrivateHostname('10.0.0.1')).toBe(true);
    expect(isPrivateHostname('10.255.255.255')).toBe(true);
  });

  it('blocks 172.16-31.x.x private', () => {
    expect(isPrivateHostname('172.16.0.1')).toBe(true);
    expect(isPrivateHostname('172.31.255.255')).toBe(true);
  });

  it('does NOT block 172.15.x.x (outside range)', () => {
    expect(isPrivateHostname('172.15.0.1')).toBe(false);
  });

  it('does NOT block 172.32.x.x (outside range)', () => {
    expect(isPrivateHostname('172.32.0.1')).toBe(false);
  });

  it('blocks 192.168.x.x private', () => {
    expect(isPrivateHostname('192.168.1.1')).toBe(true);
    expect(isPrivateHostname('192.168.0.0')).toBe(true);
  });

  it('blocks 169.254.x.x link-local (AWS/GCE metadata)', () => {
    expect(isPrivateHostname('169.254.169.254')).toBe(true);
  });

  it('blocks 100.64-127.x.x CGNAT', () => {
    expect(isPrivateHostname('100.64.0.1')).toBe(true);
    expect(isPrivateHostname('100.127.255.255')).toBe(true);
  });

  it('allows public IP', () => {
    expect(isPrivateHostname('8.8.8.8')).toBe(false);
    expect(isPrivateHostname('1.1.1.1')).toBe(false);
    expect(isPrivateHostname('93.184.216.34')).toBe(false);
  });

  it('allows public hostnames', () => {
    expect(isPrivateHostname('pornhub.com')).toBe(false);
    expect(isPrivateHostname('cdn.example.com')).toBe(false);
    expect(isPrivateHostname('xvideos.com')).toBe(false);
  });

  it('blocks empty hostname', () => {
    expect(isPrivateHostname('')).toBe(true);
    expect(isPrivateHostname(null)).toBe(true);
  });
});

describe('timingSafeEqual', () => {
  it('returns true for equal strings', async () => {
    expect(await timingSafeEqual('secret123', 'secret123')).toBe(true);
  });

  it('returns false for different strings', async () => {
    expect(await timingSafeEqual('secret123', 'secret456')).toBe(false);
  });

  it('returns false for different lengths', async () => {
    expect(await timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('returns false when one is empty', async () => {
    expect(await timingSafeEqual('', 'secret')).toBe(false);
    expect(await timingSafeEqual('secret', '')).toBe(false);
  });

  it('handles empty-vs-empty as equal', async () => {
    expect(await timingSafeEqual('', '')).toBe(true);
  });

  it('is case-sensitive', async () => {
    expect(await timingSafeEqual('Secret', 'secret')).toBe(false);
  });

  it('handles special characters', async () => {
    const key = 'k3y-w!th$p3c1@l#chars';
    expect(await timingSafeEqual(key, key)).toBe(true);
    expect(await timingSafeEqual(key, key + 'x')).toBe(false);
  });
});
