/**
 * Sandbox image allowlist
 *
 * Containers are started from images the platform ships, never from a name a
 * caller supplies. An arbitrary registry reference (e.g. `attacker/node:latest`)
 * is a supply-chain attack: the image can be backdoored, mount the workspace,
 * and read or rewrite every file in it.
 *
 * Add a new image here (with a pinned tag) before using it in the sandbox.
 */

const DEFAULT_SANDBOX_IMAGE = 'node:18-alpine';

const ALLOWED_SANDBOX_IMAGES = Object.freeze([
    // JavaScript / TypeScript
    'node:18-alpine',
    'node:22-alpine',
    // Python
    'python:3.11-alpine',
    // Java
    'openjdk:17-alpine',
    // Go
    'golang:1.21-alpine',
    'golang:1.22-alpine',
    // Rust
    'rust:1.75-alpine',
    'rust:1.78-alpine',
    // Ruby
    'ruby:3.2-alpine',
    // PHP
    'php:8.2-alpine',
]);

const IMAGE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?$/;

/**
 * Validate an image reference. Throws on a malformed name (invalid characters)
 * or a well-formed name that is not in the allowlist.
 */
function assertSandboxImage(image) {
    const value = String(image || '');
    if (!IMAGE_NAME_PATTERN.test(value)) {
        throw new Error('Invalid sandbox image');
    }
    if (!ALLOWED_SANDBOX_IMAGES.includes(value)) {
        throw new Error(`Sandbox image not permitted: ${value}`);
    }
    return value;
}

/**
 * Resolve the image to run, falling back to the default when none was asked
 * for. Both the requested and fallback values must be allowlisted.
 */
function resolveSandboxImage(requested, fallback = DEFAULT_SANDBOX_IMAGE) {
    return assertSandboxImage(requested || fallback);
}

module.exports = {
    DEFAULT_SANDBOX_IMAGE,
    ALLOWED_SANDBOX_IMAGES,
    assertSandboxImage,
    resolveSandboxImage,
};
