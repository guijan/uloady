import main from './uloady.ts';
import process from 'node:process';

process.exit(await main(process.argv.slice(2)));
