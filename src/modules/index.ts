/**
 * The modules this build runs. Both the app and the worker register this list, so a module hears
 * events from either process.
 */
import type { Module } from "@/mind/platform/modules";

export const modules: readonly Module[] = [];
