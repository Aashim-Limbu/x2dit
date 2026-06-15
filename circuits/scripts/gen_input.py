import re, json, sys
CONST='../vendor/stellar-private-payments/circuits/src/poseidon2/poseidon2_const.circom'
import os
base=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONST=os.path.join(base,'..','vendor','stellar-private-payments','circuits','src','poseidon2','poseidon2_const.circom')
src=open(CONST).read()
P=21888242871839275222246405745257275088548364400416034343698204186575808495617
def branch(fn,t):
    s=src[src.index('function '+fn):]
    key='t==%d'%t
    s=s[s.index(key):]
    nxt=s.find('t==%d'%(t+1))
    if nxt!=-1: s=s[:nxt]
    return [int(x,16) for x in re.findall(r'0x[0-9a-fA-F]+',s)]
def sb(x):x2=x*x%P;x4=x2*x2%P;return x4*x%P
def perm(state, t):
    fr=branch('POSEIDON_FULL_ROUNDS',t)       # 8*t
    pr=branch('POSEIDON_PARTIAL_ROUNDS',t)     # 56
    diag=branch('POSEIDON_INTERNAL_MAT_DIAG',t)# t
    full=[fr[i*t:(i+1)*t] for i in range(8)]
    s=list(state)
    def ext(s):
        tot=sum(s)%P; return [(tot+x)%P for x in s]
    def intl(s):
        tot=sum(s)%P; return [(s[j]*diag[j]+tot)%P for j in range(t)]
    s=ext(s)
    for i in range(4):
        s=[sb((s[j]+full[i][j])%P) for j in range(t)]; s=ext(s)
    for i in range(56):
        s[0]=sb((s[0]+pr[i])%P); s=intl(s)
    for i in range(4,8):
        s=[sb((s[j]+full[i][j])%P) for j in range(t)]; s=ext(s)
    return s
def compress(l,r): return (perm([l,r],2)[0]+l)%P
def hash2(a,b):    return perm([a,b,0],3)[0]        # commitment, t=3 sponge dsep=0
def hash1(a):      return perm([a,0],2)[0]          # nullifierHash, t=2 sponge dsep=0

nullifier=12345; secret=67890
recipient=int(sys.argv[1]) if len(sys.argv)>1 else 0x1234567890abcdef1234567890abcdef12345678
denomination=10
LEVELS=20
zeros=[0]
for i in range(1,LEVELS): zeros.append(compress(zeros[-1],zeros[-1]))
commitment=hash2(nullifier,secret)
# single-leaf tree, leaf at index 0 => all pathIndices=0, siblings=zeros
cur=commitment; pe=[]; pi=[]
for i in range(LEVELS):
    pe.append(zeros[i]); pi.append(0)
    cur=compress(cur, zeros[i])
root=cur
nh=hash1(nullifier)
inp={
 "secret":str(secret),"nullifier":str(nullifier),
 "pathElements":[str(x) for x in pe],"pathIndices":[str(x) for x in pi],
 "root":str(root),"nullifierHash":str(nh),
 "recipient":str(recipient),"denomination":str(denomination)
}
json.dump(inp, open(os.path.join(base,'build','input.json'),'w'), indent=2)
print("commitment   =0x%064x"%commitment)
print("root         =0x%064x"%root)
print("nullifierHash=0x%064x"%nh)
print("wrote build/input.json")
