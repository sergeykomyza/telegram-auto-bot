// vk.ts
import axios from 'axios';
const VK_API = 'https://api.vk.com/method';
export async function resolveGroupId(group, token, v) {
    // Group screen name -> id (negative for groups). If already numeric, return as is.
    if (/^-?\d+$/.test(group))
        return Number(group);
    const url = `${VK_API}/groups.getById`;
    const { data } = await axios.get(url, {
        params: { group_id: group.replace(/^@/, '').replace(/^public\//, ''), access_token: token, v }
    });
    const g = data?.response?.[0] || data?.response?.groups?.[0];
    const gid = g?.id;
    if (!gid)
        throw new Error('Cannot resolve group id for ' + group + ' raw: ' + JSON.stringify(data).slice(0, 500));
    return -Math.abs(gid);
}
export async function wallGet(owner_id, count, token, v) {
    const url = `${VK_API}/wall.get`;
    const { data } = await axios.get(url, {
        params: { owner_id, count, access_token: token, v, filter: 'owner' }
    });
    if (data?.response?.items)
        return data.response.items;
    // If API error structure
    // @ts-ignore
    if (data.error)
        throw new Error('VK error: ' + JSON.stringify(data.error));
    return [];
}
export function extractPhotoUrls(post, max = 4) {
    const urls = [];
    for (const att of post.attachments || []) {
        if (att.type === 'photo' && att.photo?.sizes?.length) {
            // choose the largest size
            const best = att.photo.sizes.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
            urls.push(best.url);
            if (urls.length >= max)
                break;
        }
    }
    return urls;
}
//# sourceMappingURL=vk.js.map