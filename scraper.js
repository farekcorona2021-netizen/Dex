const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://ds.alooytv16.xyz';

// هيدرز مهمة جداً لتجنب الحظر
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': BASE_URL + '/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ar,en;q=0.9'
};

// 1. تحويل IMDb ID إلى عنوان باستخدام OMDb API
async function imdbToTitle(imdbId) {
    const apiKey = process.env.OMDB_API_KEY; // لازم تضيفه في Vercel Env Variables
    const url = `https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`;
    const { data } = await axios.get(url);
    if (data.Response === 'False') throw new Error('OMDb: ' + data.Error);
    return { title: data.Title, year: data.Year, type: data.Type };
}

// 2. البحث في الموقع عبر autocompleteajax
async function searchSite(query) {
    const url = `${BASE_URL}/home/autocompleteajax?term=${encodeURIComponent(query)}`;
    const { data } = await axios.get(url, { headers: HEADERS });
    // data عبارة عن مصفوفة JSON
    return Array.isArray(data) ? data : [];
}

// 3. استخراج رابط الفيديو المباشر من صفحة الحلقة
async function extractVideoUrl(pageUrl) {
    const { data } = await axios.get(pageUrl, { headers: HEADERS });
    const $ = cheerio.load(data);
    
    // نجرب أولاً وسم video > source
    let src = $('video source').first().attr('src');
    
    // إذا ما لقينا، نجرب video نفسه
    if (!src) src = $('video').attr('src');
    
    // إذا ما لقينا، نبحث عن أي رابط ينتهي بـ .mp4 في الكود
    if (!src) {
        const match = data.match(/https?:\/\/[^\s"']+\.mp4/);
        if (match) src = match[0];
    }
    
    if (!src) return null;
    
    // التأكد من أن الرابط مطلق
    if (src.startsWith('//')) src = 'https:' + src;
    if (src.startsWith('/')) src = BASE_URL + src;
    
    return src;
}

// 4. استخراج قائمة الحلقات من صفحة المسلسل
async function extractEpisodes(seriesUrl) {
    const { data } = await axios.get(seriesUrl, { headers: HEADERS });
    const $ = cheerio.load(data);
    
    const episodes = [];
    
    // نلف على كل المواسم
    $('.season').each((seasonIdx, seasonEl) => {
        const seasonTitle = $(seasonEl).find('.movie-heading span').text().trim();
        
        // نلف على روابط الحلقات داخل هذا الموسم
        $(seasonEl).find('a.btn-ep, a.btn-primary').each((epIdx, epEl) => {
            const href = $(epEl).attr('href');
            const label = $(epEl).text().trim(); // مثلاً "Ep#1"
            
            if (href) {
                const epNumber = parseInt(label.replace(/\D/g, '')) || (epIdx + 1);
                episodes.push({
                    season: seasonIdx + 1,
                    seasonTitle: seasonTitle,
                    episode: epNumber,
                    label: label,
                    url: href.startsWith('http') ? href : BASE_URL + href
                });
            }
        });
    });
    
    return episodes;
}

// 5. الدالة الرئيسية
async function getStreams(imdbId, type, season, episode) {
    try {
        // الخطوة 1: تحويل IMDb ID إلى عنوان
        const { title, year } = await imdbToTitle(imdbId);
        console.log(`🎬 العنوان: ${title} (${year})`);

        // الخطوة 2: البحث في الموقع
        let results = await searchSite(title);
        
        // إذا ما لقينا نتائج، نجرب البحث مع السنة
        if (results.length === 0) {
            results = await searchSite(`${title} ${year}`);
        }
        
        if (results.length === 0) {
            console.log('❌ ما لقيت نتائج في الموقع');
            return [];
        }

        console.log(`✅ لقيت ${results.length} نتيجة`);
        const match = results[0];
        const pageUrl = match.url;
        console.log(`🔗 رابط الصفحة: ${pageUrl}`);

        // الخطوة 3: إذا كان مسلسل، نستخرج الحلقات
        if (type === 'series' || match.type === 'TV-Series') {
            const episodes = await extractEpisodes(pageUrl);
            console.log(`📺 عدد الحلقات: ${episodes.length}`);

            // نبحث عن الحلقة المطلوبة
            let targetEp = episodes.find(
                e => e.season === season && e.episode === episode
            );
            
            // إذا ما لقيناها بالضبط، ناخذ أول حلقة من الموسم المطلوب
            if (!targetEp) {
                targetEp = episodes.find(e => e.season === season) || episodes[0];
            }

            if (!targetEp) return [];

            console.log(`▶️ الحلقة المستهدفة: ${targetEp.label} (${targetEp.url})`);
            const videoUrl = await extractVideoUrl(targetEp.url);

            if (!videoUrl) return [];

            return [{
                title: `AlooyTV | ${match.title} | ${targetEp.label}`,
                url: videoUrl,
                quality: 'HD'
            }];
        }

        // الخطوة 4: إذا كان فيلم، نستخرج رابط الفيديو مباشرة
        const videoUrl = await extractVideoUrl(pageUrl);
        if (!videoUrl) return [];

        return [{
            title: `AlooyTV | ${match.title}`,
            url: videoUrl,
            quality: 'HD'
        }];

    } catch (error) {
        console.error('❌ خطأ:', error.message);
        return [];
    }
}

module.exports = { getStreams };
