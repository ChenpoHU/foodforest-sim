// net/codec.js
// Wire (de)serialisation primitives for the binary protocol shared with
// the Rust server. The server encodes with bincode v2 (varint-prefixed),
// and frames every message as [u16 msgType][u32 payloadLen][payload].
//
// This module is PURE — it holds no game state and imports nothing, so
// it's safe to reuse anywhere on the client.

/** Streaming reader over a Uint8Array payload (bincode v2 layout). */
export class BincodeReader {
    constructor(buffer) {
        this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        this.offset = 0;
    }

    readU8() {
        const v = this.view.getUint8(this.offset);
        this.offset += 1;
        return v;
    }

    readBool() {
        return this.readU8() !== 0;
    }

    readVarint() {
        const first = this.readU8();
        if (first < 251) return first;
        if (first === 251) {
            const lo = this.readU8();
            const hi = this.readU8();
            return lo | (hi << 8);
        }
        if (first === 252) {
            const b0 = this.readU8();
            const b1 = this.readU8();
            const b2 = this.readU8();
            const b3 = this.readU8();
            return b0 | (b1 << 8) | (b2 << 16) | ((b3 << 24) >>> 0);
        }
        if (first === 253) {
            const lo = this.readU8() | (this.readU8() << 8) |
                       (this.readU8() << 16) | ((this.readU8() << 24) >>> 0);
            const hi = this.readU8() | (this.readU8() << 8) |
                       (this.readU8() << 16) | ((this.readU8() << 24) >>> 0);
            return lo + hi * 0x100000000;
        }
        throw new Error("Invalid varint prefix: " + first);
    }

    readU16() { return this.readVarint(); }
    readU32() { return this.readVarint(); }
    readU64() { return this.readVarint(); }

    readF32() {
        const v = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return v;
    }

    readString() {
        const len = this.readVarint();
        const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
        this.offset += len;
        return new TextDecoder().decode(bytes);
    }

    readBytes(n) {
        const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, n);
        this.offset += n;
        return bytes;
    }

    remaining() {
        return this.view.byteLength - this.offset;
    }
}

// ── Encoder helpers (return arrays of bytes for concatenation) ────────

export function encodeVarint(value) {
    if (value < 251) return [value];
    if (value <= 0xFFFF) return [251, value & 0xFF, (value >> 8) & 0xFF];
    if (value <= 0xFFFFFFFF) return [252, value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >> 24) & 0xFF];
    throw new Error("varint > u32 not implemented for encoder");
}

export function encodeZigzagVarint(value) {
    const zigzag = (value << 1) ^ (value >> 31);
    return encodeVarint(zigzag >>> 0);
}

export function encodeF32(value) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, true);
    return [...new Uint8Array(buf)];
}

export function encodeBincodeString(str) {
    const bytes = new TextEncoder().encode(str);
    return [...encodeVarint(bytes.length), ...bytes];
}

/** Wrap a payload byte array in the [u16 type][u32 len][payload] frame. */
export function buildFramedMessage(msgType, payloadBytes) {
    const frame = new Uint8Array(6 + payloadBytes.length);
    const view = new DataView(frame.buffer);
    view.setUint16(0, msgType, true);
    view.setUint32(2, payloadBytes.length, true);
    frame.set(payloadBytes, 6);
    return frame;
}
