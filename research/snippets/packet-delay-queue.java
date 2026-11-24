// packet-delay-queue.java — patrón PacketDelay (du-addon-public / DupersUnited).
// Referencia: cómo se encola y se sueltan paquetes C2S en ráfaga.
// NO se compila en el bot: ilustra la primitiva que replicamos con window_click crudo.

package io.lolyay.addon.modules;

import net.minecraft.network.packet.Packet;
import java.util.LinkedList;
import java.util.Queue;
import java.util.Set;

public class PacketDelay {
    // Paquetes C2S seleccionados por el usuario (ClickSlot, ButtonClick, ChatCommand...).
    private final Queue<Packet<?>> packets = new LinkedList<>();
    private Set<Class<? extends Packet<?>>> c2sPackets;

    // Al activar: se limpia la cola.
    public void onActivate() {
        packets.clear();
    }

    // Al desactivar: se sueltan TODOS juntos (el "blink").
    public void onDeactivate(net.minecraft.client.network.ClientPlayNetworkHandler handler) {
        int i = packets.size();
        while (!packets.isEmpty()) {
            handler.sendPacket(packets.poll());
        }
        // log: "Sent %d Packets!"
    }

    // Intercepta el envío: si el paquete está en la lista, se encola y se cancela.
    public void onPacketSend(Packet<?> packet, Runnable cancel) {
        if (c2sPackets.contains(packet.getClass())) {
            packets.add(packet);
            cancel.run(); // event.cancel()
        }
    }
}
