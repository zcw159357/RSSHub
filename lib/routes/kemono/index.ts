import { Route } from '@/types';
import { getCurrentPath } from '@/utils/helpers';
const __dirname = getCurrentPath(import.meta.url);

import cache from '@/utils/cache';
import got from '@/utils/got';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';
import { art } from '@/utils/render';
import path from 'node:path';

export const route: Route = {
    path: '/:source?/:id?',
    categories: ['anime'],
    example: '/kemono',
    parameters: { source: 'Source, see below, Posts by default', id: 'User id, can be found in URL' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['kemono.su/:source/user/:id', 'kemono.su/'],
        },
    ],
    name: 'Posts',
    maintainers: ['nczitzk'],
    handler,
    description: `Sources

  | Posts | Patreon | Pixiv Fanbox | Gumroad | SubscribeStar | DLsite | Discord | Fantia |
  | ----- | ------- | ------------ | ------- | ------------- | ------ | ------- | ------ |
  | posts | patreon | fanbox       | gumroad | subscribestar | dlsite | discord | fantia |

  :::tip
  When \`posts\` is selected as the value of the parameter **source**, the parameter **id** does not take effect.
  :::`,
};

async function handler(ctx) {
    const limit = ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit')) : 25;
    const source = ctx.req.param('source') ?? '';
    const id = ctx.req.param('id');

    const rootUrl = 'https://kemono.su';
    const apiUrl = `${rootUrl}/api/v1/discord/channel/lookup/${id}`;
    const currentUrl = `${rootUrl}/${source ? `${source}/${source === 'discord' ? `server/${id}` : `user/${id}`}` : 'posts'}`;

    const headers = {
        cookie: '__ddg2=sBQ4uaaGecmfEUk7',
    };

    const response = await got({
        method: 'get',
        url: source === 'discord' ? apiUrl : currentUrl,
        headers,
    });

    let items = [],
        title = '',
        image;

    if (source === 'discord') {
        title = `Posts of ${id} from Discord | Kemono`;

        items = await Promise.all(
            response.data.map((channel) =>
                cache.tryGet(channel.id, async () => {
                    const channelResponse = await got({
                        method: 'get',
                        url: `${rootUrl}/api/v1/discord/channel/${channel.id}?o=0`,
                        headers,
                    });

                    return channelResponse.data
                        .filter((i) => i.content || i.attachments)
                        .slice(0, limit)
                        .map((i) => ({
                            title: i.content,
                            description: art(path.join(__dirname, 'templates', 'discord.art'), { i }),
                            author: `${i.author.username}#${i.author.discriminator}`,
                            pubDate: parseDate(i.published),
                            category: channel.name,
                            guid: `kemono:${source}:${i.server}:${i.channel}:${i.id}`,
                            link: `https://discord.com/channels/${i.server}/${i.channel}/${i.id}`,
                        }));
                })
            )
        );
        items = items.flat();
    } else {
        const $ = load(response.data);

        title = $('title').text();
        image = $('.user-header__avatar img[src]').attr('src');

        items = await Promise.all(
            $('.card-list__items')
                .find('a')
                .slice(0, limit)
                .toArray()
                .map((item) => {
                    item = $(item);

                    return {
                        link: `${rootUrl}${item.attr('href')}`,
                    };
                })
                .map((item) =>
                    cache.tryGet(item.link, async () => {
                        const detailResponse = await got({
                            method: 'get',
                            url: item.link,
                            headers,
                        });

                        const content = load(detailResponse.data);

                        content('.post__thumbnail').each(function () {
                            const href = content(this).find('.fileThumb').attr('href');
                            content(this).html(`<img src="${href.startsWith('http') ? href : rootUrl + href}">`);
                        });

                        item.description = content('.post__body')
                            .each(function () {
                                content(this).find('.ad-container').remove();
                            })
                            .html();
                        item.author = content('.post__user-name').text();
                        item.title = content('.post__title span').first().text();
                        item.guid = item.link.replace('kemono.su', 'kemono.party');
                        item.pubDate = parseDate(content('div.post__published').contents().last().text().trim());

                        // find the first attachment with a file extension we
                        // want, and set it as the enclosure
                        content('.post__attachment-link[href][download]').each(function () {
                            const extension = content(this).attr('download').replace(/.*\./, '').toLowerCase();
                            const mimeType =
                                {
                                    m4a: 'audio/mp4',
                                    mp3: 'audio/mpeg',
                                    mp4: 'video/mp4',
                                }[extension] || null;
                            if (mimeType === null) {
                                return;
                            }

                            item.enclosure_url = content(this).attr('href');
                            item.enclosure_type = mimeType;

                            return false;
                        });

                        return item;
                    })
                )
        );
    }

    return {
        title,
        image,
        link: currentUrl,
        item: items,
    };
}
