// The world look's bloom: a post effect plugin of the style (look.post.add puts it in the chain; look.post.set({ bloom: false }) or
// engine.plugins.off('world/10-bloom') turns it off). Costly: starts off on low-tier devices.
import { bloom } from '@threedog/post-effects';

export default bloom({ strength: 0.35, radius: 0.5, threshold: 0.85 });
