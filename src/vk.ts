// vk.ts

import axios from 'axios';

export type VkPost = {
  id: number;
  owner_id: number;
  date: number; // unix
  text: string;
  attachments?: Array<{
    type: string;
    photo?: {
      sizes: Array<{ url: string; width: number; height: number }>;
    };
  }>;
};

export type VkWallGetResponse = {
  response: {
    count: number;
    items: VkPost[];
  };
};

const VK_API = 'https://api.vk.com/method';

export async function resolveGroupId(group: string, token: string, v: string): Promise<number> {
  // Group screen name -> id (negative for groups). If already numeric, return as is.
  if (/^-?\d+$/.test(group)) return Number(group);
  const url = `${VK_API}/groups.getById`;
  const { data } = await axios.get(url, {
    params: { group_id: group.replace(/^@/,'').replace(/^public\//,''), access_token: token, v }
  });
  const g = data?.response?.[0] || data?.response?.groups?.[0];
  const gid = g?.id;
  if (!gid) throw new Error('Cannot resolve group id for ' + group + ' raw: ' + JSON.stringify(data).slice(0,500));
  return -Math.abs(gid);
}

export async function wallGet(owner_id: number, count: number, token: string, v: string): Promise<VkPost[]> {
  const url = `${VK_API}/wall.get`;
  const { data } = await axios.get<VkWallGetResponse>(url, {
    params: { owner_id, count, access_token: token, v, filter: 'owner' }
  });
  if (data?.response?.items) return data.response.items;
  // If API error structure
  // @ts-ignore
  if (data.error) throw new Error('VK error: ' + JSON.stringify(data.error));
  return [];
}

export function extractPhotoUrls(post: VkPost, max: number = 4): string[] {
  const urls: string[] = [];
  for (const att of post.attachments || []) {
    if (att.type === 'photo' && att.photo?.sizes?.length) {
      // choose the largest size
      const best = att.photo.sizes.reduce((a,b) => (a.width*a.height >= b.width*b.height ? a : b));
      urls.push(best.url);
      if (urls.length >= max) break;
    }
  }
  return urls;
}