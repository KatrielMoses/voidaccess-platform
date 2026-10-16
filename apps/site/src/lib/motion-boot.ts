/**
 * Inline in the root layout's <head> (server-rendered, runs before first paint): adds `va-m` to <html> when entrances
 * may play, `va-still` under ?static or prefers-reduced-motion. A plain module (no React) so the server layout can
 * import it; lib/motion.ts lifts the class.
 */
// Keep in step with lib/motion.ts and the html.va-m rules in globals.css.
export const MOTION_BOOT =
  "(function(){try{var d=document.documentElement;if(/[?&]static/.test(location.search)||matchMedia('(prefers-reduced-motion: reduce)').matches){d.classList.add('va-still');return}d.classList.add('va-m');setTimeout(function(){d.classList.remove('va-m')},4000)}catch(e){}})()";
