# Bundle Dupe V3 Fix

This is a small and reliable Paper plugin that patches a recently discovered bundle duplication exploit, demonstrated by
DuperTrooper and Autism Inc.

Videos demonstrating the exploit:

* [DuperTrooper](https://youtu.be/W0XNVUW5uWI)
* [Autism Inc.](https://youtu.be/0pz9-D_YINQ)

### How the dupe works

A dupe module deliberately floods the Netty pipeline with oversized or excessive packets, so the client connection
remains technically active but becomes stalled. While the pipeline is still draining, a `use item` packet is sent,
followed by a server-side kick (or any action that disconnects the player).

The server saves the player's inventory and unloads the player from the world, effectively kicking them from the server,
while the Netty channel is still considered alive and the player's `Connection` continues to be ticked. During this
window, the queued `use item` packet is processed, causing the bundle's contents to be dropped by a player entity that
no longer exists in the world. This results in item duplication.

### The fix

On player quit, the plugin calls the player's `clearActiveItem` method; this stops the processing of the stuck
`use item` state and prevents the duplication behavior.
