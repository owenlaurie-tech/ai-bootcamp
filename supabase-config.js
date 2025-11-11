// ============================================
// Supabase Configuration
// ============================================
// Replace these with your actual Supabase project credentials
// You can find these in your Supabase project settings:
// https://rbacdmvrbnfnqjjovfne.supabase.co/project/_/settings/api

const SUPABASE_URL = 'https://rbacdmvrbnfnqjjovfne.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJiYWNkbXZyYm5mbnFqam92Zm5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI4ODQ4MDQsImV4cCI6MjA3ODQ2MDgwNH0.BLx2GakndBYtshobYluI1UQ5KnhSNJhnUyJndO4djlQ'; // Replace with your actual anon key

// Initialize Supabase client (will be available after including Supabase CDN in HTML)
let supabase;

function initializeSupabase() {
    if (typeof window.supabase === 'undefined') {
        console.error('Supabase library not loaded. Make sure to include the Supabase CDN script in your HTML.');
        return null;
    }

    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return supabase;
}
