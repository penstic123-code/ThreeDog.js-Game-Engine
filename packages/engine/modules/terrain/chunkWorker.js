// Terrain worker: generates chunk meshes and vegetation placement off the main thread (one per engine.threads slot).
import { serve } from '../../core/threads/threadServe.js';
import { chunkHandler } from './chunkJob.js';

serve(chunkHandler());
