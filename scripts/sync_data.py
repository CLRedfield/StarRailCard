"""Entry point used by npm run data:sync. No browser automation involved."""
from import_game_data import main as import_data
from fetch_assets import main as import_assets

if __name__ == '__main__':
    import_data()
    import_assets()
