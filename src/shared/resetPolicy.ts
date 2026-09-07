/** No setting or renderer payload can opt into the unsafe legacy wipe. Replace
 * only with verified shutdown plus recoverable, explicitly scoped reset. */
export const RESET_UNAVAILABLE_REASON = 'Reset is unavailable while recoverable shutdown and data retention are being completed. Your settings, memories and run history have not been changed.';
