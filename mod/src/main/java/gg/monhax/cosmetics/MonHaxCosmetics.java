package gg.monhax.cosmetics;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.util.Identifier;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;

/** Liest <gameDir>/monhax/cosmetics.json (vom Launcher geschrieben) und lädt die Cape. */
public final class MonHaxCosmetics {
    private static Identifier cape;
    private static boolean loaded;

    private MonHaxCosmetics() {}

    public static Identifier cape() {
        if (!loaded) {
            loaded = true;
            try {
                Path f = FabricLoader.getInstance().getGameDir().resolve("monhax").resolve("cosmetics.json");
                if (Files.exists(f)) {
                    JsonObject o = JsonParser.parseString(Files.readString(f)).getAsJsonObject();
                    if (o.has("cape") && !o.get("cape").isJsonNull()) {
                        try (InputStream in = Files.newInputStream(Path.of(o.get("cape").getAsString()))) {
                            NativeImage img = NativeImage.read(in);
                            Identifier id = Identifier.of("monhax_cosmetics", "cape");
                            MinecraftClient.getInstance().getTextureManager().registerTexture(id, new NativeImageBackedTexture(img));
                            cape = id;
                        }
                    }
                }
            } catch (Exception e) {
                System.err.println("[MonHax Cosmetics] Cape konnte nicht geladen werden: " + e);
            }
        }
        return cape;
    }
}
