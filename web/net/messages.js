// net/messages.js
// ActionKind encoders — each turns a player action into the bincode
// byte sequence the server expects (enum variant index as a varint,
// then the fields). Pure: depends only on the codec primitives.

import { encodeVarint, encodeZigzagVarint } from "./codec.js";

export function encodePlantAction(speciesId, x, y, z) {
    // PlantSeed { species_id: u16, position: [i32; 3] }
    return [
        ...encodeVarint(0),
        ...encodeVarint(speciesId),
        ...encodeZigzagVarint(x), ...encodeZigzagVarint(y), ...encodeZigzagVarint(z),
    ];
}

export function encodeHarvestAction(entityId) {
    // Harvest { entity_id: EntityId(u64) }
    return [...encodeVarint(1), ...encodeVarint(entityId)];
}

export function encodeWaterAction(x, y, z) {
    return [
        ...encodeVarint(3),
        ...encodeZigzagVarint(x), ...encodeZigzagVarint(y), ...encodeZigzagVarint(z),
        3, // radius
    ];
}

export function encodeSwaleAction(x, y, z) {
    return [
        ...encodeVarint(4),
        ...encodeZigzagVarint(x), ...encodeZigzagVarint(y), ...encodeZigzagVarint(z),
        0, // direction
    ];
}

export function encodeHugelAction(x, y, z) {
    return [
        ...encodeVarint(5),
        ...encodeZigzagVarint(x), ...encodeZigzagVarint(y), ...encodeZigzagVarint(z),
    ];
}

export function encodeCutTreeAction(entityId) {
    return [...encodeVarint(10), ...encodeVarint(entityId)];
}

export function encodeInspectAction(entityId) {
    return [...encodeVarint(11), ...encodeVarint(entityId)];
}

export function encodeHuntAction(entityId) {
    return [...encodeVarint(12), ...encodeVarint(entityId)];
}

export function encodeEatAction(itemId) {
    // EatItem { item_id: u16 } — variant 14
    return [...encodeVarint(14), ...encodeVarint(itemId)];
}

export function encodeSellAction(itemId, count) {
    // SellItem { item_id: u16, count: u16 } — variant 15
    return [...encodeVarint(15), ...encodeVarint(itemId), ...encodeVarint(count)];
}

export function encodeDeployAIAction(x, y, z) {
    // DeploySemiAI { position: [i32; 3] } — variant 16
    return [
        ...encodeVarint(16),
        ...encodeZigzagVarint(x), ...encodeZigzagVarint(y), ...encodeZigzagVarint(z),
    ];
}

export function encodePropagandaAction(tone, message) {
    // Propaganda { tone: u8, message: String } — variant 17
    const msgBytes = new TextEncoder().encode(message);
    return [
        ...encodeVarint(17),
        tone & 0xff,
        ...encodeVarint(msgBytes.length),
        ...msgBytes,
    ];
}

export function encodeGrantUbiAction(targetPlayerId, amount) {
    // GrantUbi { target_player_id: u64, amount: u32 } — variant 18
    // target_player_id is a varint (bincode standard for u64). 0 = all
    // farmers.
    return [
        ...encodeVarint(18),
        ...encodeVarint(targetPlayerId),
        ...encodeVarint(amount),
    ];
}

export function encodeIssueTaskAction(tone, message, taskKind, target, reward) {
    // IssueTask { tone: u8, message: String, task_kind: u8, target: u32,
    //             reward: u32 } — variant 19
    const msgBytes = new TextEncoder().encode(message);
    return [
        ...encodeVarint(19),
        tone & 0xff,
        ...encodeVarint(msgBytes.length),
        ...msgBytes,
        taskKind & 0xff,
        ...encodeVarint(target),
        ...encodeVarint(reward),
    ];
}

export function encodeAscendAction() {
    // AscendToMonarch — variant 20, no fields.
    return [...encodeVarint(20)];
}

export function encodeRevoltAction(targetMonarchId) {
    // Revolt { target_monarch_id: u64 } — variant 21
    return [
        ...encodeVarint(21),
        ...encodeVarint(targetMonarchId),
    ];
}

export function encodeResearchAction(topic) {
    // Research { topic: u8 } — variant 22
    return [
        ...encodeVarint(22),
        topic & 0xff,
    ];
}

export function encodeDeployBreakthroughAction(kind) {
    // DeployBreakthrough { kind: u8 } — variant 23
    return [
        ...encodeVarint(23),
        kind & 0xff,
    ];
}

export function encodeHochsitzAction(x, y, z) {
    return [
        ...encodeVarint(13),
        ...encodeZigzagVarint(x), ...encodeZigzagVarint(y), ...encodeZigzagVarint(z),
    ];
}

export function encodeCraftAction(recipe) {
    // Craft { recipe: u8 } — variant 24. recipe 0 = Linen Tunic,
    // 1 = Fur Coat, 255 = take off (back to default clothes).
    return [
        ...encodeVarint(24),
        recipe & 0xff,
    ];
}

export function encodeBuySongAction(songId) {
    // BuySong { song_id: u8 } — variant 25. Buys one of Aurona's songs
    // from the Songbook store (0=Strawberry, 1=Enhanced, 2=Humandroid).
    return [
        ...encodeVarint(25),
        songId & 0xff,
    ];
}

export function encodePlantBrainChipAction() {
    // PlantBrainChip — variant 26, no fields. A dying Farmer takes the chip.
    return [...encodeVarint(26)];
}

export function encodeAcceptFateAction() {
    // AcceptFate — variant 27, no fields. A dying Farmer accepts death.
    return [...encodeVarint(27)];
}

export function encodeRemoveChipAction() {
    // RemoveChip — variant 28, no fields. Innovator de-chips the nearest
    // chipped Farmer within reach.
    return [...encodeVarint(28)];
}
