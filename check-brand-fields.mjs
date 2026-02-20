import PocketBase from 'pocketbase';
const pb = new PocketBase('http://144.31.116.66:8090');
try {
    const brands = await pb.collection('brands').getList(1, 1);
    const brand = brands.items[0];
    if (brand) {
        console.log('BRAND FIELDS:', Object.keys(brand));
        console.log('BRAND SAMPLE:', JSON.stringify(brand, null, 2));
    } else {
        console.log('No brands found');
    }
} catch (e) {
    console.error('Error:', e.message);
}
