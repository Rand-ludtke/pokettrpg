import paramiko
import os
import time

HOST = '192.168.10.117'
USER = 'randl'
PASSWORD = 'shark55'

files = [
    (r'D:\GitHub\pokettrpg\tauri-app\public\data\custom-overrides\generated\extra-pokemon.json',
     '/home/randl/pokettrpg/tauri-app/public/data/custom-overrides/generated/extra-pokemon.json'),
    (r'D:\GitHub\pokettrpg\tauri-app\public\data\custom-overrides\generated\pokedex.extra-pokemon.json',
     '/home/randl/pokettrpg/tauri-app/public/data/custom-overrides/generated/pokedex.extra-pokemon.json'),
    (r'D:\GitHub\pokettrpg\tauri-app\public\data\custom-overrides\generated\learnsets.extra-pokemon.json',
     '/home/randl/pokettrpg/tauri-app/public/data/custom-overrides/generated/learnsets.extra-pokemon.json'),
    (r'D:\GitHub\pokettrpg\tauri-app\public\data\pokeathlon\generated\pokedex.pokeathlon.json',
     '/home/randl/pokettrpg/tauri-app/public/data/pokeathlon/generated/pokedex.pokeathlon.json'),
    (r'D:\GitHub\pokettrpg\pokemonttrpg-backend\data\customdex.json',
     '/home/randl/pokettrpg/pokemonttrpg-backend/data/customdex.json'),
    (r'D:\GitHub\pokettrpg\tauri-app\public\vendor\showdown\data\pokedex.json',
     '/home/randl/pokettrpg/tauri-app/public/vendor/showdown/data/pokedex.json'),
    (r'D:\GitHub\pokettrpg\tauri-app\public\vendor\showdown\data\learnsets.json',
     '/home/randl/pokettrpg/tauri-app/public/vendor/showdown/data/learnsets.json'),
    (r'D:\GitHub\pokettrpg\tauri-app\public\vendor\showdown\sprites\ani\conductree.gif',
     '/home/randl/pokettrpg/tauri-app/public/vendor/showdown/sprites/ani/conductree.gif'),
    (r'D:\GitHub\pokettrpg\tauri-app\public\vendor\showdown\sprites\gen5\conductree.png',
     '/home/randl/pokettrpg/tauri-app/public/vendor/showdown/sprites/gen5/conductree.png'),
]

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASSWORD, timeout=10)
print('Connected to Pi via SSH')

sftp = ssh.open_sftp()
for local, remote in files:
    remote_dir = os.path.dirname(remote)
    ssh.exec_command(f'mkdir -p "{remote_dir}"')
    time.sleep(0.05)
    sftp.put(local, remote)
    print(f'Uploaded: {remote}')
sftp.close()

print('Restarting pokettrpg-backend on Pi...')
stdin, stdout, stderr = ssh.exec_command(f'echo {PASSWORD} | sudo -S systemctl restart pokettrpg-backend 2>&1')
print(stdout.read().decode())

time.sleep(3)
stdin, stdout, stderr = ssh.exec_command('systemctl is-active pokettrpg-backend')
print('Service status:', stdout.read().decode().strip())

stdin, stdout, stderr = ssh.exec_command('curl -s http://127.0.0.1:3000/api/health')
print('Health:', stdout.read().decode().strip())

stdin, stdout, stderr = ssh.exec_command('curl -s http://127.0.0.1:3000/api/customdex')
out = stdout.read().decode()
print('Has conductree in customdex:', 'conductree' in out)
print('Has jolteonrevy in customdex:', 'jolteonrevy' in out)

ssh.close()
print('PI DEPLOYMENT COMPLETE!')
