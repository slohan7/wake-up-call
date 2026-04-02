#!/usr/bin/env node

import { DatabaseService } from './database';

async function migrate() {
  console.log('🔧 Running database migrations...\n');
  
  try {
    const db = new DatabaseService();
    
    // The schema is automatically initialized in the DatabaseService constructor
    console.log('✅ Database schema initialized successfully');
    
    // Test the connection
    db.createPerson({
      email: 'test@example.com',
      name: 'Test User',
      company: 'Test Company',
      importance: 5,
      last_contact: null,
    });
    
    console.log('✅ Database connection test passed');
    
    // Clean up test data
    db.deletePersonByEmail('test@example.com');
    
    db.close();
    console.log('\n✨ Migration completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  migrate().catch(console.error);
}

export { migrate };
