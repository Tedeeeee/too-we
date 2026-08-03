export const SLOT_COLORS = Object.freeze({
  1: '#E4D2BA',
  2: '#F3BCBC',
});

export const EMPTY_SETTINGS = Object.freeze({ recordAlert: '' });

const cleanString = (value) => (typeof value === 'string' ? value.trim() : '');

const isoTimestamp = (value) => {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const memberView = ({ alias, userId, name, slot }) => ({
  id: alias,
  userId: userId ?? null,
  name: name ?? '',
  initial: name?.slice(0, 1) ?? '',
  color: SLOT_COLORS[slot],
});

export function mapCouple({ userId, couple, profiles = [], invite, now = new Date() }) {
  const nameById = new Map(profiles.map((profile) => [profile.id, profile.display_name ?? '']));
  const members = (couple?.couple_members ?? [])
    .filter((member) => member.left_at == null)
    .sort((a, b) => a.slot - b.slot);
  const mine = members.find((member) => member.user_id === userId);
  const theirs = members.find((member) => member.user_id !== userId);
  const mySlot = mine?.slot ?? 1;
  const partnerSlot = theirs?.slot ?? (mySlot === 1 ? 2 : 1);
  const myName = nameById.get(userId) ?? '';
  const partnerName = theirs ? (nameById.get(theirs.user_id) ?? '') : '';
  const inviteExpiresAt = invite?.status === 'active' ? isoTimestamp(invite.expires_at) : null;
  const nowTimestamp = now instanceof Date ? now.getTime() : Date.parse(now);
  const inviteIsShareable =
    Boolean(inviteExpiresAt) &&
    Number.isFinite(nowTimestamp) &&
    Date.parse(inviteExpiresAt) > nowTimestamp;

  return {
    coupleId: couple?.id ?? null,
    connected: couple?.status === 'active' && Boolean(mine && theirs),
    onboarded: Boolean(couple && myName),
    inviteCode: inviteIsShareable ? cleanString(invite.code) : '',
    inviteExpiresAt,
    startDate: couple?.started_on ?? couple?.connected_at ?? couple?.created_at ?? null,
    me: memberView({ alias: 'me', userId, name: myName, slot: mySlot }),
    partner: memberView({
      alias: 'partner',
      userId: theirs?.user_id ?? null,
      name: partnerName,
      slot: partnerSlot,
    }),
  };
}

export function normalizeEntryText(value) {
  const text = cleanString(value);
  return text || null;
}

export function normalizeRating(value) {
  if (value === null || value === undefined || value === '') return null;
  const rating = Number(value);
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

export function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanString).filter(Boolean);
}

export function mapVisit(row, userId) {
  if (!row) return null;

  const rawEntries = Array.isArray(row.visit_entries) ? row.visit_entries : [];
  const myEntry = rawEntries.find((entry) => entry.author_id === userId);
  const entries = rawEntries
    .filter((entry) => {
      const text = normalizeEntryText(entry.note);
      if (entry.author_id === userId) return Boolean(text);
      return Boolean(text) || normalizeRating(entry.rating) !== null;
    })
    .map((entry) => {
      const mine = entry.author_id === userId;
      return {
        memberId: mine ? 'me' : 'partner',
        authorUserId: entry.author_id,
        text: normalizeEntryText(entry.note),
        rating: normalizeRating(entry.rating) ?? 0,
        readOnly: !mine,
      };
    })
    .sort((a, b) => (a.memberId === 'me' ? -1 : 1) - (b.memberId === 'me' ? -1 : 1));

  const tags = (Array.isArray(row.visit_tags) ? row.visit_tags : [])
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((tag) => tag.label);
  const photos = (Array.isArray(row.visit_photos) ? row.visit_photos : [])
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((photo) => ({
      id: photo.id,
      ordinal: photo.ordinal,
      order: photo.ordinal,
      bucket: photo.storage_bucket,
      path: photo.storage_path,
      uploaderId: photo.uploader_id,
      ownedByMe: photo.uploader_id === userId,
    }));

  return {
    id: row.id,
    coupleId: row.couple_id,
    placeId: row.place_provider_id,
    placeName: row.place_name,
    category: row.place_category ?? '',
    date: row.visited_at,
    pending: normalizeEntryText(myEntry?.note) === null,
    rating: normalizeRating(myEntry?.rating) ?? 0,
    flower: row.flower_key ?? null,
    tags,
    photos,
    entries,
    place: {
      provider: row.place_provider,
      providerId: row.place_provider_id ?? null,
      name: row.place_name,
      category: row.place_category ?? null,
      address: row.place_address ?? null,
      roadAddress: row.place_road_address ?? null,
      phone: row.place_phone ?? null,
      url: row.place_url ?? null,
      lat: row.place_lat ?? null,
      lng: row.place_lng ?? null,
    },
  };
}

export function mapWishlistPlace(row, nameById) {
  return {
    id: row.id,
    name: row.place_name,
    category: row.place_category ?? '',
    pickedBy: nameById.get(row.created_by) ?? '',
    pickedByUserId: row.created_by,
  };
}

const addText = (target, key, value) => {
  const text = cleanString(value);
  if (text) target[key] = text;
};

const addCoordinate = (target, key, value) => {
  if (typeof value === 'number' && Number.isFinite(value)) target[key] = value;
};

export function toPlacePayload(place) {
  if (!place || typeof place !== 'object' || Array.isArray(place)) return null;
  const name = cleanString(place.name);
  if (!name) return null;

  const providerId = cleanString(place.providerId ?? place.provider_id ?? place.id);
  const payload = {
    provider: cleanString(place.provider) || (providerId ? 'kakao' : 'manual'),
  };
  if (providerId) payload.provider_id = providerId;
  payload.name = name;
  addText(payload, 'category', place.category);
  addText(payload, 'address', place.address);
  addText(payload, 'road_address', place.roadAddress ?? place.road_address);
  addText(payload, 'phone', place.phone);
  addText(payload, 'url', place.url);
  addCoordinate(payload, 'lat', place.lat);
  addCoordinate(payload, 'lng', place.lng);
  return payload;
}
