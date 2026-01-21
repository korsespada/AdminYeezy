// Test PocketBase connection and data structure
const PocketBase = require('pocketbase')

const pb = new PocketBase('http://144.31.116.66:8090')

async function test() {
  try {
    console.log('Testing PocketBase connection...')
    console.log('URL:', pb.baseUrl)
    
    // Test fetching one product
    const products = await pb.collection('products').getList(1, 1, {
      expand: 'brand,category',
    })
    
    console.log('\n✅ Connection successful!')
    console.log('\nSample product structure:')
    console.log(JSON.stringify(products.items[0], null, 2))
    
    console.log('\nTotal products:', products.totalItems)
    
  } catch (error) {
    console.error('\n❌ Connection failed:', error.message)
    console.error('Status:', error.status)
  }
}

test()
